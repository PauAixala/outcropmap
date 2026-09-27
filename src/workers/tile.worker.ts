/**
 * Worker entry point: owns one WorldGenerator, renders raster tiles and answers probes.
 * Implements the protocol in ./protocol.ts exactly. Never touches the DOM — colours arrive
 * pre-resolved in each tile request's palette.
 */
/// <reference lib="webworker" />
import '@worldgen/profiles';
import type { DimensionId, GeneratorSettings, ProfileId, WorldGenerator } from '@worldgen/api/types';
import { createGenerator } from '@worldgen/registry';
import { getRasterLayer } from '@layers/index';
import { TileSampleCache, type SampleCacheContext } from '@layers/sample-cache';
import { TILE_SIZE_PX, blocksPerPixel, tileOriginBlock } from '@core/coords/coords';
import type {
  FeatureRequest,
  ProbeRequest,
  TileRequest,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

// Shadows the ambient `self` (which, with both DOM and WebWorker libs loaded, resolves to an
// awkward union) with the precise worker global scope type.
declare const self: DedicatedWorkerGlobalScope;

/**
 * Everything tied to the worker's current (seed, profile, dimension, settings) session, replaced
 * wholesale on every `init` message -- including `sampleCache`: a fresh `TileSampleCache` per
 * session is the simplest way to guarantee the raw-sample cache (`src/layers/sample-cache.ts`) is
 * invalidated exactly on the changes that affect its values (seed/profile/dimension/settings) and
 * never on a filter change, without a separate "clear on session change" call to remember to make.
 */
interface ActiveSession {
  readonly generator: WorldGenerator;
  readonly seed: string;
  readonly profile: ProfileId;
  readonly dimension: DimensionId;
  readonly settings: GeneratorSettings;
  readonly sampleCache: TileSampleCache;
}

let active: ActiveSession | null = null;
const cancelledIds = new Set<number>();

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  handle(event.data);
});

function handle(request: WorkerRequest): void {
  switch (request.type) {
    case 'init':
      active = {
        generator: createGenerator(request.profile, {
          seed: BigInt(request.seed),
          dimension: request.dimension,
          settings: request.settings,
        }),
        seed: request.seed,
        profile: request.profile,
        dimension: request.dimension,
        settings: request.settings,
        sampleCache: new TileSampleCache(),
      };
      break;
    case 'cancel':
      cancelledIds.add(request.id);
      break;
    case 'tile':
      handleTile(request);
      break;
    case 'probe':
      handleProbe(request);
      break;
    case 'features':
      handleFeatures(request);
      break;
  }
}

function handleTile(request: TileRequest): void {
  if (!active) {
    postError(request.id, 'worker not initialised: no active seed/profile session');
    return;
  }
  if (consumeCancelled(request.id)) return;

  const layer = getRasterLayer(request.layer);
  if (!layer) {
    postError(request.id, `no raster layer registered for '${request.layer}'`);
    return;
  }

  const size = TILE_SIZE_PX;
  const bpp = blocksPerPixel(request.zoom);
  const originX = tileOriginBlock(request.tileX, request.zoom);
  const originZ = tileOriginBlock(request.tileZ, request.zoom);
  const out = new Uint8ClampedArray(size * size * 4);
  const sampleCacheContext: SampleCacheContext = {
    cache: active.sampleCache,
    seed: active.seed,
    profile: active.profile,
    dimension: active.dimension,
    settings: active.settings,
    zoom: request.zoom,
    tileX: request.tileX,
    tileZ: request.tileZ,
  };
  layer.render(
    active.generator,
    out,
    originX,
    originZ,
    size,
    bpp,
    request.palette,
    request.filter,
    sampleCacheContext,
    request.detail ?? 0,
  );

  if (consumeCancelled(request.id)) return;

  const imageData = new ImageData(out, size, size);
  createImageBitmap(imageData)
    .then((bitmap) => {
      if (consumeCancelled(request.id)) {
        bitmap.close();
        return;
      }
      const response: WorkerResponse = { type: 'tile', id: request.id, bitmap };
      self.postMessage(response, [bitmap]);
    })
    .catch((err: unknown) => {
      postError(request.id, err instanceof Error ? err.message : 'tile render failed');
    });
}

function handleFeatures(request: FeatureRequest): void {
  if (!active) {
    postError(request.id, 'worker not initialised: no active seed/profile session');
    return;
  }
  if (consumeCancelled(request.id)) return;
  const features = active.generator.features(request.box, request.kinds, request.ores);
  const response: WorkerResponse = { type: 'features', id: request.id, features };
  self.postMessage(response);
}

function handleProbe(request: ProbeRequest): void {
  if (!active) {
    postError(request.id, 'worker not initialised: no active seed/profile session');
    return;
  }
  if (consumeCancelled(request.id)) return;
  const probe = active.generator.probe(request.x, request.z);
  const response: WorkerResponse = { type: 'probe', id: request.id, probe };
  self.postMessage(response);
}

function consumeCancelled(id: number): boolean {
  if (!cancelledIds.has(id)) return false;
  cancelledIds.delete(id);
  return true;
}

function postError(id: number, message: string): void {
  const response: WorkerResponse = { type: 'error', id, message };
  self.postMessage(response);
}
