/**
 * Tile pipeline: keeps an LRU cache of decoded tile bitmaps, requests whatever a viewport needs
 * (in a deterministic clockwise spiral starting at the tile under the viewport centre -- see
 * `spiralOffsets`, `./spiral.ts`) and cancels in-flight work for tiles that have panned
 * off-screen. See docs/ARCHITECTURE.md "Caching".
 */
import type { DimensionId, GeneratorSettings, LayerId, ProfileId } from '@worldgen/api/types';
import type { MapFilter } from '@layers/filter';
import { blockToTile, tileOriginBlock, tileSpanBlocks } from '@core/coords/coords';
import type { WorkerPool } from '@workers/pool';
import { LruCache } from './lru-cache';
import { tileKey } from './tile-key';
import { spiralOffsets } from './spiral';
import { MAX_TERRAIN_DETAIL } from '@layers/height-field';

/** Background refinement requests allowed at once, across every layer. See `refine`. */
const REFINE_BUDGET = 2;

export interface TileManagerOptions {
  readonly pool: WorkerPool;
  /** Maximum number of decoded bitmaps kept in memory at once. */
  readonly maxTiles?: number;
  /** Called whenever a requested tile finishes decoding, so the caller can schedule a repaint. */
  readonly onTileReady: () => void;
}

export interface CachedTile {
  readonly bitmap: ImageBitmap;
  readonly zoom: number;
  readonly tileX: number;
  readonly tileZ: number;
}

export class TileManager {
  private readonly pool: WorkerPool;
  private readonly cache: LruCache<string, ImageBitmap>;
  private readonly inFlight = new Map<string, number>();
  /**
   * Background refinement requests (`refine`). Kept apart from `inFlight` on purpose: they must not
   * count as loading — the compass would spin for a minute and every load phase would wait on them.
   */
  private readonly refining = new Map<string, number>();
  /** Layers that have received at least one refined tile, so plain layers skip the detail lookups. */
  private readonly refinedLayers = new Set<LayerId>();
  private readonly onTileReady: () => void;
  private seed = '0';
  private profile: ProfileId = 'tfg';

  constructor(options: TileManagerOptions) {
    this.pool = options.pool;
    this.onTileReady = options.onTileReady;
    this.cache = new LruCache<string, ImageBitmap>(options.maxTiles ?? 512, (_key, bitmap) => {
      bitmap.close();
    });
  }

  /** Switches the active seed/profile/dimension: reinitialises every worker and drops all tiles. */
  setSession(seed: bigint, profile: ProfileId, dimension: DimensionId, settings: GeneratorSettings = {}): void {
    this.seed = seed.toString();
    this.profile = profile;
    this.clearAll();
    this.pool.setSession(seed, profile, dimension, settings);
  }

  /** Drops every cached/in-flight tile without touching the worker session (e.g. on theme change,
   * per ADR 0005 — colours are baked into each tile bitmap). */
  clearAll(): void {
    for (const id of this.inFlight.values()) this.pool.cancel(id);
    this.inFlight.clear();
    for (const id of this.refining.values()) this.pool.cancel(id);
    this.refining.clear();
    this.cache.clear();
  }

  /** The sharpest cached version of a tile: a refined one when there is one. */
  getTile(layer: LayerId, zoom: number, tileX: number, tileZ: number): ImageBitmap | undefined {
    const detail = this.bestDetail(layer, zoom, tileX, tileZ);
    return detail < 0 ? undefined : this.cache.get(this.key(layer, zoom, tileX, tileZ, detail));
  }

  /** Highest cached detail for a tile, or -1 when no version of it is cached. */
  private bestDetail(layer: LayerId, zoom: number, tileX: number, tileZ: number): number {
    if (this.refinedLayers.has(layer)) {
      for (let detail = MAX_TERRAIN_DETAIL; detail > 0; detail--) {
        if (this.cache.has(this.key(layer, zoom, tileX, tileZ, detail))) return detail;
      }
    }
    return this.cache.has(this.key(layer, zoom, tileX, tileZ)) ? 0 : -1;
  }

  /**
   * Drops every cached/in-flight tile for one layer only, in the current session, leaving every
   * other layer's tiles untouched (docs/ARCHITECTURE.md "Caching": "a change to layer settings
   * invalidates only that layer's tiles"). Used when a `filter` criterion changes -- unlike
   * `layerOpacity`, which is pure canvas compositing (ADR 0007) and never needs this, a filter
   * value is baked into the tile bitmap itself, so the previously-rendered pixels are now stale.
   */
  invalidateLayer(layer: LayerId): void {
    const prefix = `${this.seed}|${this.profile}|${layer}|`;
    for (const pending of [this.inFlight, this.refining]) {
      for (const [key, id] of [...pending]) {
        if (!key.startsWith(prefix)) continue;
        this.pool.cancel(id);
        pending.delete(key);
      }
    }
    for (const key of [...this.cache.entries()].map(([k]) => k)) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Returns cached tiles for this session that intersect the viewport. Older zooms are included
   * so the painter can keep a previous map visible while the new zoom is rendering. */
  getCachedTiles(
    layer: LayerId,
    minBlockX: number,
    minBlockZ: number,
    maxBlockX: number,
    maxBlockZ: number,
  ): CachedTile[] {
    const prefix = `${this.seed}|${this.profile}|${layer}|`;
    const result: CachedTile[] = [];
    for (const [key, bitmap] of this.cache.entries()) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.split('|');
      // Six parts for a base tile, seven with a refinement suffix (`tileKey`).
      if (parts.length !== 6 && parts.length !== 7) continue;
      const zoom = Number(parts[3]);
      const tileX = Number(parts[4]);
      const tileZ = Number(parts[5]);
      if (!Number.isInteger(zoom) || !Number.isInteger(tileX) || !Number.isInteger(tileZ)) continue;
      const originX = tileOriginBlock(tileX, zoom);
      const originZ = tileOriginBlock(tileZ, zoom);
      const span = tileSpanBlocks(zoom);
      if (originX > maxBlockX || originX + span < minBlockX || originZ > maxBlockZ || originZ + span < minBlockZ) continue;
      result.push({ bitmap, zoom, tileX, tileZ });
    }
    return result;
  }

  /**
   * Ensures every tile covering [minBlockX..maxBlockX] x [minBlockZ..maxBlockZ] for `layer` is
   * cached or in flight, requesting whatever is missing in a clockwise spiral starting at the
   * tile under the box's centre (`spiralOffsets`) -- the tile the user is actually looking at
   * finishes first, and the rest fill in visibly outward -- and cancels in-flight requests for
   * tiles that are no longer wanted.
   */
  ensureVisible(
    layer: LayerId,
    zoom: number,
    minBlockX: number,
    minBlockZ: number,
    maxBlockX: number,
    maxBlockZ: number,
    palette: Record<string, number>,
    /** Only meaningful for the `filter` layer -- see `TileJob.filter` (../../workers/pool.ts). */
    filter?: MapFilter,
  ): void {
    const minTx = blockToTile(minBlockX, zoom);
    const maxTx = blockToTile(maxBlockX, zoom);
    const minTz = blockToTile(minBlockZ, zoom);
    const maxTz = blockToTile(maxBlockZ, zoom);
    // The tile actually under the screen centre -- not the midpoint of the tile-index range,
    // which can differ from it by up to half a tile when the viewport is not tile-aligned. Both
    // block-space midpoints are exactly `camera.centerX`/`centerZ` by construction (the painter
    // builds `minBlockX`/`maxBlockX` as `camera.centerX -+ halfW`), so this recovers the real
    // screen centre without needing the camera object here.
    const centerTx = blockToTile((minBlockX + maxBlockX) / 2, zoom);
    const centerTz = blockToTile((minBlockZ + maxBlockZ) / 2, zoom);
    // `blockToTile` floors, so centerTx/Tz are always within [minTx, maxTx] / [minTz, maxTz] --
    // this is the smallest spiral radius that still reaches every corner of the viewport.
    const maxRadius = Math.max(centerTx - minTx, maxTx - centerTx, centerTz - minTz, maxTz - centerTz, 0);

    const wanted = new Set<string>();
    const toRequest: { tx: number; tz: number; key: string }[] = [];

    for (const offset of spiralOffsets(maxRadius)) {
      const tx = centerTx + offset.tx;
      const tz = centerTz + offset.tz;
      if (tx < minTx || tx > maxTx || tz < minTz || tz > maxTz) continue;
      const key = this.key(layer, zoom, tx, tz);
      wanted.add(key);
      // Any cached version counts: a refined tile replaces its base tile, and must not make this
      // think the base is missing and fetch it all over again.
      if (this.inFlight.has(key) || this.bestDetail(layer, zoom, tx, tz) >= 0) continue;
      toRequest.push({ tx, tz, key });
    }

    for (const [key, id] of this.inFlight) {
      if (key.startsWith(`${this.seed}|${this.profile}|${layer}|${zoom}|`) && !wanted.has(key)) {
        this.pool.cancel(id);
        this.inFlight.delete(key);
      }
    }

    // `toRequest` is already in spiral order (centre tile first) -- no further sort.
    for (const t of toRequest) {
      const { id, promise } = this.pool.requestTile({
        layer,
        zoom,
        tileX: t.tx,
        tileZ: t.tz,
        palette,
        // `exactOptionalPropertyTypes`: only set the key when there is a value.
        ...(filter !== undefined ? { filter } : {}),
      });
      this.inFlight.set(t.key, id);
      promise
        .then((bitmap) => {
          if (this.inFlight.get(t.key) !== id) {
            bitmap.close();
            return;
          }
          this.inFlight.delete(t.key);
          this.cache.set(t.key, bitmap);
          this.onTileReady();
        })
        .catch(() => {
          if (this.inFlight.get(t.key) === id) this.inFlight.delete(t.key);
        });
    }
  }

  /**
   * Which layers currently have tiles in flight, in no particular order. Drives the loading
   * indicator, which is why it reads the keys rather than keeping a second counter in step.
   */
  pendingLayers(): LayerId[] {
    const layers = new Set<LayerId>();
    for (const key of this.inFlight.keys()) {
      // tileKey() is `seed|profile|layer|zoom|x|z` — see ./tile-key.ts.
      const layer = key.split('|')[2];
      if (layer !== undefined) layers.add(layer as LayerId);
    }
    return [...layers];
  }

  /**
   * Background refinement for a `refinable` layer: re-renders the visible tiles with a denser height
   * grid, one detail step at a time over the whole view (coarsest first), centre outwards.
   *
   * Deliberately modest. The painter only calls this once nothing is loading, at most
   * `REFINE_BUDGET` requests run at once across all layers, and they go to the least busy workers.
   * A refined tile replaces the coarser versions of itself in the cache rather than sitting beside
   * them, and a request for a tile that has left the view is cancelled.
   */
  refine(
    layer: LayerId,
    zoom: number,
    minBlockX: number,
    minBlockZ: number,
    maxBlockX: number,
    maxBlockZ: number,
    palette: Record<string, number>,
    maxDetail: number,
  ): void {
    const minTx = blockToTile(minBlockX, zoom);
    const maxTx = blockToTile(maxBlockX, zoom);
    const minTz = blockToTile(minBlockZ, zoom);
    const maxTz = blockToTile(maxBlockZ, zoom);
    const centerTx = blockToTile((minBlockX + maxBlockX) / 2, zoom);
    const centerTz = blockToTile((minBlockZ + maxBlockZ) / 2, zoom);
    const maxRadius = Math.max(centerTx - minTx, maxTx - centerTx, centerTz - minTz, maxTz - centerTz, 0);

    // Visible tiles that exist at all, in spiral order, with the detail each already has.
    const visible: { tx: number; tz: number; detail: number }[] = [];
    let coarsest = Number.POSITIVE_INFINITY;
    for (const offset of spiralOffsets(maxRadius)) {
      const tx = centerTx + offset.tx;
      const tz = centerTz + offset.tz;
      if (tx < minTx || tx > maxTx || tz < minTz || tz > maxTz) continue;
      const detail = this.bestDetail(layer, zoom, tx, tz);
      if (detail < 0) continue;
      visible.push({ tx, tz, detail });
      coarsest = Math.min(coarsest, detail);
    }
    const target = coarsest + 1;

    const wanted = new Set<string>();
    if (target <= maxDetail) {
      for (const tile of visible) {
        if (tile.detail < target) wanted.add(this.key(layer, zoom, tile.tx, tile.tz, target));
      }
    }
    const prefix = `${this.seed}|${this.profile}|${layer}|`;
    for (const [key, id] of [...this.refining]) {
      if (key.startsWith(prefix) && !wanted.has(key)) {
        this.pool.cancel(id);
        this.refining.delete(key);
      }
    }

    for (const tile of visible) {
      if (this.refining.size >= REFINE_BUDGET) return;
      const key = this.key(layer, zoom, tile.tx, tile.tz, target);
      if (!wanted.has(key) || this.refining.has(key)) continue;
      const { id, promise } = this.pool.requestTile({
        layer,
        zoom,
        tileX: tile.tx,
        tileZ: tile.tz,
        palette,
        detail: target,
      });
      this.refining.set(key, id);
      promise
        .then((bitmap) => {
          if (this.refining.get(key) !== id) {
            bitmap.close();
            return;
          }
          this.refining.delete(key);
          this.cache.set(key, bitmap);
          this.refinedLayers.add(layer);
          // Supersedes the coarser versions; `delete` closes their bitmaps.
          for (let detail = 0; detail < target; detail++) {
            this.cache.delete(this.key(layer, zoom, tile.tx, tile.tz, detail));
          }
          this.onTileReady();
        })
        .catch(() => {
          if (this.refining.get(key) === id) this.refining.delete(key);
        });
    }
  }

  private key(layer: LayerId, zoom: number, tileX: number, tileZ: number, detail = 0): string {
    return tileKey({ seed: this.seed, profile: this.profile, layer, zoom, tileX, tileZ, detail });
  }
}
