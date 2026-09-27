/**
 * Vector-feature pipeline: caches deposits per MC region (512 blocks, `MC_REGION_SIZE`), never per
 * tile or per frame -- AGENTS.md section 5: "Vector features (veins, structures) are computed per
 * region, not per tile, and cached separately... never recomputed per frame or per filter change.
 * Filtering is a predicate over cached features." Mirrors `TileManager`'s cache/session-reset shape
 * but is far simpler: one `FeatureSet` per region, no zoom axis, no bitmap lifetime to manage.
 */
import type { DepositFeature, DimensionId, FeatureSet, ProfileId, StructureFeature, FeatureKind } from '@worldgen/api/types';
import { MC_REGION_SIZE, blockToMcRegion } from '@core/coords/coords';
import { veinFilterId } from '@worldgen/api/types';
import type { WorkerPool } from '@workers/pool';
import { LruCache } from './lru-cache';

export interface FeatureManagerOptions {
  readonly pool: WorkerPool;
  /** Maximum number of regions' worth of features kept in memory at once. */
  readonly maxRegions?: number;
  /** Called whenever a requested region's features finish loading, so the caller can repaint. */
  readonly onFeaturesReady: () => void;
}

/** Regions of structures kept at once. A few bytes each; enough for a zoomed-out view several times over. */
const STRUCTURE_REGION_CACHE = 4096;

export class FeatureManager {
  private readonly pool: WorkerPool;
  /**
   * One cache per kind: a region can have its structures loaded and its deposits not. Structures
   * are a handful of entries per region, so their cache holds far more regions — a zoomed-out view
   * spans hundreds, and a cache smaller than the view evicts and re-requests them every frame.
   */
  private readonly caches: Record<FeatureKind, LruCache<string, FeatureSet>>;
  private readonly inFlight = new Set<string>();
  /** Deposits per region per ore, filled when the map is filtered to some ores. */
  private readonly perOre = new LruCache<string, readonly DepositFeature[]>(16384);
  private readonly onFeaturesReady: () => void;
  private seed = '0';
  private profile: ProfileId = 'tfg';

  constructor(options: FeatureManagerOptions) {
    this.pool = options.pool;
    this.onFeaturesReady = options.onFeaturesReady;
    this.caches = {
      deposits: new LruCache<string, FeatureSet>(options.maxRegions ?? 256),
      structures: new LruCache<string, FeatureSet>(STRUCTURE_REGION_CACHE),
    };
  }

  /** Switches the active seed/profile/dimension: drops every cached region's features. Does not
   * touch `WorkerPool` sessions itself -- the caller's `TileManager.setSession` already does that
   * for the same (seed, profile, dimension) change. */
  setSession(seed: bigint, profile: ProfileId, _dimension: DimensionId): void {
    this.seed = seed.toString();
    this.profile = profile;
    this.clearAll();
  }

  /** Drops every cached region (e.g. on theme change, for parity with `TileManager.clearAll` --
   * features carry no colour, but this keeps the two caches' lifecycles easy to reason about
   * together). */
  clearAll(): void {
    this.caches.deposits.clear();
    this.caches.structures.clear();
    this.perOre.clear();
    this.inFlight.clear();
  }

  private key(regionX: number, regionZ: number): string {
    return `${this.seed}|${this.profile}|${regionX},${regionZ}`;
  }

  /** Whether any region's features are still being generated. Drives the loading indicator. */
  isPending(): boolean {
    return this.inFlight.size > 0;
  }

  /** Cached features for one MC region, or `undefined` if not yet loaded (a request has been
   * kicked off in the background; call again after `onFeaturesReady` fires). */
  getRegion(regionX: number, regionZ: number, kind: FeatureKind = 'deposits'): FeatureSet | undefined {
    return this.caches[kind].get(this.key(regionX, regionZ));
  }

  /**
   * Ensures every MC region intersecting the given block-space viewport has been requested.
   * Idempotent: a region already cached or already in flight is skipped.
   */
  ensureVisible(
    minBlockX: number,
    minBlockZ: number,
    maxBlockX: number,
    maxBlockZ: number,
    kind: FeatureKind = 'deposits',
    /** For deposits: the selected ore filter ids. Empty means every ore. */
    ores: readonly string[] = [],
  ): void {
    const cache = this.caches[kind];
    for (let rz = blockToMcRegion(minBlockZ); rz <= blockToMcRegion(maxBlockZ); rz++) {
      for (let rx = blockToMcRegion(minBlockX); rx <= blockToMcRegion(maxBlockX); rx++) {
        const regionKey = this.key(rx, rz);
        // What this region still needs. Deposits are cached per ore once a filter is set, so
        // selecting a second ore generates only that ore; a region already loaded with every ore
        // answers any selection without asking again.
        let missing: readonly string[] = [];
        if (kind === 'deposits' && ores.length > 0) {
          if (cache.has(regionKey)) continue;
          missing = ores.filter((ore) => {
            const key = `${regionKey}|${ore}`;
            return !this.perOre.has(key) && !this.inFlight.has(`deposits|${key}`);
          });
          if (missing.length === 0) continue;
        } else if (cache.has(regionKey) || this.inFlight.has(`${kind}|${regionKey}`)) {
          continue;
        }
        const flightKeys = missing.length > 0 ? missing.map((ore) => `deposits|${regionKey}|${ore}`) : [`${kind}|${regionKey}`];
        for (const key of flightKeys) this.inFlight.add(key);
        const box = {
          minX: rx * MC_REGION_SIZE,
          minZ: rz * MC_REGION_SIZE,
          maxX: rx * MC_REGION_SIZE + MC_REGION_SIZE - 1,
          maxZ: rz * MC_REGION_SIZE + MC_REGION_SIZE - 1,
        };
        const currentSeed = this.seed;
        const currentProfile = this.profile;
        const settle = (): void => {
          for (const key of flightKeys) this.inFlight.delete(key);
        };
        this.pool.requestFeatures(box, [kind], missing).promise.then(
          (features) => {
            settle();
            // A session change while this was in flight: the result belongs to another world.
            if (this.seed !== currentSeed || this.profile !== currentProfile) return;
            if (missing.length === 0) {
              cache.set(regionKey, features);
            } else {
              for (const ore of missing) {
                this.perOre.set(
                  `${regionKey}|${ore}`,
                  features.deposits.filter((deposit) => veinFilterId(deposit.ore) === ore),
                );
              }
            }
            this.onFeaturesReady();
          },
          settle,
        );
      }
    }
  }

  /** Every cached structure start within the box, across every loaded region touching it. */
  structuresInView(minBlockX: number, minBlockZ: number, maxBlockX: number, maxBlockZ: number): readonly StructureFeature[] {
    const structures: StructureFeature[] = [];
    for (let rz = blockToMcRegion(minBlockZ); rz <= blockToMcRegion(maxBlockZ); rz++) {
      for (let rx = blockToMcRegion(minBlockX); rx <= blockToMcRegion(maxBlockX); rx++) {
        const region = this.getRegion(rx, rz, 'structures');
        if (!region) continue;
        for (const structure of region.structures) {
          if (structure.x >= minBlockX && structure.x <= maxBlockX && structure.z >= minBlockZ && structure.z <= maxBlockZ) {
            structures.push(structure);
          }
        }
      }
    }
    return structures;
  }

  /** Every cached deposit within the box, for the given ore selection (empty: every ore). Regions
   * not loaded yet simply contribute nothing yet. */
  depositsInView(
    minBlockX: number,
    minBlockZ: number,
    maxBlockX: number,
    maxBlockZ: number,
    ores: readonly string[] = [],
  ): readonly DepositFeature[] {
    const deposits: DepositFeature[] = [];
    const inBox = (d: DepositFeature): boolean =>
      d.x >= minBlockX && d.x <= maxBlockX && d.z >= minBlockZ && d.z <= maxBlockZ;
    for (let rz = blockToMcRegion(minBlockZ); rz <= blockToMcRegion(maxBlockZ); rz++) {
      for (let rx = blockToMcRegion(minBlockX); rx <= blockToMcRegion(maxBlockX); rx++) {
        const regionKey = this.key(rx, rz);
        const whole = this.caches.deposits.get(regionKey);
        if (whole) {
          for (const deposit of whole.deposits) {
            if (inBox(deposit) && (ores.length === 0 || ores.includes(veinFilterId(deposit.ore)))) deposits.push(deposit);
          }
          continue;
        }
        for (const ore of ores) {
          for (const deposit of this.perOre.get(`${regionKey}|${ore}`) ?? []) {
            if (inBox(deposit)) deposits.push(deposit);
          }
        }
      }
    }
    return deposits;
  }
}
