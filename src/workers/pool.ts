/**
 * Worker pool: sizing, round-robin dispatch, in-flight tracking, cancellation.
 * One WorldGenerator instance lives per worker per (seed, profile, dimension) — see
 * docs/ARCHITECTURE.md "Worker protocol". The main thread only ever calls a generator directly
 * for nothing; all generation happens here, across the pool.
 */
import type { BlockBox, DimensionId, FeatureSet, GeneratorSettings, LayerId, Probe, ProfileId, FeatureKind } from '@worldgen/api/types';
import type { MapFilter } from '@layers/filter';
import type {
  CancelRequest,
  FeatureRequest,
  ProbeRequest,
  TileRequest,
  WorkerInit,
  WorkerResponse,
} from './protocol';
import { tileOriginBlock, tileSpanBlocks } from '@core/coords/coords';

export interface TileJob {
  readonly layer: LayerId;
  readonly zoom: number;
  readonly tileX: number;
  readonly tileZ: number;
  /** Resolved theme colours (see @ui/theme), so workers never touch the DOM. */
  readonly palette: Record<string, number>;
  /** Only meaningful for the `filter` layer -- see `TileRequest.filter` (./protocol.ts). */
  readonly filter?: MapFilter;
  /** Background refinement level for refinable layers -- see `TileManager.refine`. */
  readonly detail?: number;
}

// The routing bucket, sized to the unit a worker actually caches: a TFC region cell is 96 grid of
// 128 blocks = 12 288 blocks across (docs/WORLDGEN-NOTES.md). The previous 16 384 was "close to the
// region scale" but not aligned to it, so tiles sharing a region could hash to different workers
// and each would rebuild it. The number is kept here rather than imported so this module stays
// independent of a version-specific worldgen module.
const ROUTING_BUCKET_BLOCKS = 12_288;

/**
 * Stable routing keeps adjacent zooms centred on the same TFC region in the same worker, so that
 * worker's region cache keeps paying off across a zoom change.
 *
 * On its own this is not a scheduling policy: when the viewport is smaller than a routing bucket —
 * i.e. any time you are zoomed in — every visible tile hashes to one or two workers and the rest
 * sit idle. Measured with 8 workers over a 9x9 tile viewport: 4 workers used at zoom 4 and below,
 * all 8 only at zoom 6. `WorkerPool.pickWorker` therefore treats this as a *preference* and falls
 * back to the least-loaded worker when the preferred one is saturated.
 */
export function workerIndexForTile(job: Pick<TileJob, 'zoom' | 'tileX' | 'tileZ'>, workerCount: number): number {
  if (workerCount <= 1) return 0;
  const span = tileSpanBlocks(job.zoom);
  const centerX = tileOriginBlock(job.tileX, job.zoom) + span / 2;
  const centerZ = tileOriginBlock(job.tileZ, job.zoom) + span / 2;
  const regionX = Math.floor(centerX / ROUTING_BUCKET_BLOCKS);
  const regionZ = Math.floor(centerZ / ROUTING_BUCKET_BLOCKS);
  const hash = Math.imul(regionX, 0x45d9f3b) ^ Math.imul(regionZ, 0x27d4eb2d);
  return (hash >>> 0) % workerCount;
}

interface PendingTile {
  readonly kind: 'tile';
  readonly resolve: (bitmap: ImageBitmap) => void;
  readonly reject: (err: Error) => void;
}

interface PendingProbe {
  readonly kind: 'probe';
  readonly resolve: (probe: Probe) => void;
  readonly reject: (err: Error) => void;
}

interface PendingFeatures {
  readonly kind: 'features';
  readonly resolve: (features: FeatureSet) => void;
  readonly reject: (err: Error) => void;
}

type Pending = PendingTile | PendingProbe | PendingFeatures;

function computePoolSize(): number {
  const hc =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(8, Math.max(2, hc - 1));
}

export class WorkerPool {
  /**
   * How far ahead of the least-loaded worker the spatially preferred worker may run before a job
   * is handed to someone else. Small enough to keep every worker busy, large enough that a short
   * burst of same-region tiles still lands together and shares the region cache.
   */
  private static readonly AFFINITY_SLACK = 2;

  private readonly workers: Worker[];
  private readonly inFlight: number[];
  private nextId = 1;
  private readonly pending = new Map<number, { workerIndex: number; job: Pending }>();

  constructor(size: number = computePoolSize()) {
    this.workers = [];
    this.inFlight = new Array<number>(size).fill(0);
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      });
      this.workers.push(worker);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  /** (Re)initialises every worker's generator. Call on seed/profile/dimension change. */
  setSession(seed: bigint, profile: ProfileId, dimension: DimensionId, settings: GeneratorSettings = {}): void {
    for (const id of this.pending.keys()) this.cancel(id);
    const init: WorkerInit = { type: 'init', seed: seed.toString(), profile, dimension, settings };
    for (const worker of this.workers) worker.postMessage(init);
  }

  requestTile(job: TileJob): { id: number; promise: Promise<ImageBitmap> } {
    const id = this.nextId++;
    // Refinement is background work: send it to whichever worker is least busy, never to the one a
    // visible area's own tiles are routed to, so it does not sit in front of them.
    const workerIndex = job.detail
      ? this.lightestWorker()
      : this.pickWorker(workerIndexForTile(job, this.workers.length));
    const promise = new Promise<ImageBitmap>((resolve, reject) => {
      this.pending.set(id, { workerIndex, job: { kind: 'tile', resolve, reject } });
    });
    const request: TileRequest = {
      type: 'tile',
      id,
      layer: job.layer,
      zoom: job.zoom,
      tileX: job.tileX,
      tileZ: job.tileZ,
      palette: job.palette,
      // `exactOptionalPropertyTypes`: only set the key when there is a value, rather than ever
      // assigning it `undefined` explicitly.
      ...(job.filter !== undefined ? { filter: job.filter } : {}),
      ...(job.detail ? { detail: job.detail } : {}),
    };
    this.inFlight[workerIndex] = (this.inFlight[workerIndex] ?? 0) + 1;
    this.workers[workerIndex]?.postMessage(request);
    return { id, promise };
  }

  /** Vector features (deposits, structures) for a block-space box, routed by the same spatial
   * affinity as tiles covering that box's centre -- see `workerIndexForTile`'s doc comment. Not
   * cached here; the caller (a `FeatureManager`, per AGENTS.md section 5) owns per-region caching
   * so a repeated request for the same region never re-crosses the worker boundary. */
  requestFeatures(
    box: BlockBox,
    kinds?: readonly FeatureKind[],
    ores?: readonly string[],
  ): { id: number; promise: Promise<FeatureSet> } {
    const id = this.nextId++;
    const centerX = (box.minX + box.maxX) / 2;
    const centerZ = (box.minZ + box.maxZ) / 2;
    const workerIndex = this.pickWorker(this.workerIndexForBlock(centerX, centerZ));
    const promise = new Promise<FeatureSet>((resolve, reject) => {
      this.pending.set(id, { workerIndex, job: { kind: 'features', resolve, reject } });
    });
    const request: FeatureRequest = {
      type: 'features',
      id,
      box,
      ...(kinds ? { kinds } : {}),
      ...(ores && ores.length > 0 ? { ores } : {}),
    };
    this.inFlight[workerIndex] = (this.inFlight[workerIndex] ?? 0) + 1;
    this.workers[workerIndex]?.postMessage(request);
    return { id, promise };
  }

  requestProbe(x: number, z: number): { id: number; promise: Promise<Probe> } {
    const id = this.nextId++;
    const workerIndex = this.pickWorker(this.workerIndexForBlock(x, z));
    const promise = new Promise<Probe>((resolve, reject) => {
      this.pending.set(id, { workerIndex, job: { kind: 'probe', resolve, reject } });
    });
    const request: ProbeRequest = { type: 'probe', id, x, z };
    this.inFlight[workerIndex] = (this.inFlight[workerIndex] ?? 0) + 1;
    this.workers[workerIndex]?.postMessage(request);
    return { id, promise };
  }

  /** Cancels an in-flight tile or probe request. Safe to call after it has already resolved. */
  cancel(id: number): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    this.release(entry.workerIndex);
    entry.job.reject(new Error('Generation request cancelled'));
    const request: CancelRequest = { type: 'cancel', id };
    this.workers[entry.workerIndex]?.postMessage(request);
  }

  terminate(): void {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
    this.inFlight.length = 0;
    this.pending.clear();
  }

  /**
   * Spatial affinity as a preference, not a rule: use the preferred worker unless it is more than
   * AFFINITY_SLACK jobs ahead of the least-loaded one, in which case hand the job to that one.
   * Without this, a zoomed-in viewport keeps most of the pool idle (see workerIndexForTile).
   */
  private pickWorker(preferred: number): number {
    if (this.workers.length <= 1) return 0;
    let lightest = 0;
    for (let i = 1; i < this.workers.length; i++) {
      if ((this.inFlight[i] ?? 0) < (this.inFlight[lightest] ?? 0)) lightest = i;
    }
    const preferredLoad = this.inFlight[preferred] ?? 0;
    const lightestLoad = this.inFlight[lightest] ?? 0;
    return preferredLoad - lightestLoad > WorkerPool.AFFINITY_SLACK ? lightest : preferred;
  }

  private lightestWorker(): number {
    let lightest = 0;
    for (let i = 1; i < this.workers.length; i++) {
      if ((this.inFlight[i] ?? 0) < (this.inFlight[lightest] ?? 0)) lightest = i;
    }
    return lightest;
  }

  private release(workerIndex: number): void {
    const current = this.inFlight[workerIndex] ?? 0;
    if (current > 0) this.inFlight[workerIndex] = current - 1;
  }

  private workerIndexForBlock(x: number, z: number): number {
    const regionX = Math.floor(x / ROUTING_BUCKET_BLOCKS);
    const regionZ = Math.floor(z / ROUTING_BUCKET_BLOCKS);
    const hash = Math.imul(regionX, 0x45d9f3b) ^ Math.imul(regionZ, 0x27d4eb2d);
    return this.workers.length <= 1 ? 0 : (hash >>> 0) % this.workers.length;
  }

  private handleMessage(message: WorkerResponse): void {
    const entry = this.pending.get(message.id);
    if (!entry) {
      if (message.type === 'tile') message.bitmap.close();
      return;
    }
    this.pending.delete(message.id);
    this.release(entry.workerIndex);
    if (message.type === 'error') {
      entry.job.reject(new Error(message.message));
      return;
    }
    if (message.type === 'tile' && entry.job.kind === 'tile') {
      entry.job.resolve(message.bitmap);
    } else if (message.type === 'probe' && entry.job.kind === 'probe') {
      entry.job.resolve(message.probe);
    } else if (message.type === 'features' && entry.job.kind === 'features') {
      entry.job.resolve(message.features);
    }
  }
}
