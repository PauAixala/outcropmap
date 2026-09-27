/**
 * Cluster veins — `net.dries007.tfc.world.feature.vein.ClusterVeinFeature` (TFC 1.20.x).
 *
 * This is where the metal ores live: 49 of TerraFirmaGreg's 76 veins are clusters, against 20 discs
 * and 7 pipes, so without this the map has no copper, iron, gold or anything else worth a trip.
 *
 * ```java
 * protected Vein createVein(WorldGenerationContext context, int chunkX, int chunkZ, RandomSource random, ClusterVeinConfig config) {
 *     return new Vein(defaultPos(chunkX, chunkZ, random, config), Metaballs3D.simple(random, config.size()));
 * }
 *
 * protected final BlockPos defaultPos(int chunkX, int chunkZ, RandomSource random, C config) {
 *     return new BlockPos(chunkX + random.nextInt(16), defaultYPos(config.verticalRadius(), random, config), chunkZ + random.nextInt(16));
 * }
 *
 * protected float getChanceToGenerate(int x, int y, int z, Vein vein, ClusterVeinConfig config) {
 *     return vein.metaballs.inside(x, y, z) ? config.config().density() : 0;
 * }
 *
 * // ClusterVeinConfig
 * public int chunkRadius()    { return 1 + (size >> 4); }
 * public int verticalRadius() { return size; }
 * ```
 *
 * The rarity roll, the chunk RNG seed and `defaultYPos` are shared with the disc port next door —
 * they live on `VeinFeature`, not on either subclass, so they are imported rather than re-derived.
 *
 * **Excluded veins.** Like the disc port, this skips any vein with `near_lava: true` (an
 * existence-level gate this port cannot evaluate). A `project: true` vein's Y range is an offset
 * from the surface, so it is placed on the profile's surface height and dropped where there is none
 * (`surfaceY` below): placing it at absolute Y would put markers at depths the game never uses.
 *
 * **What this port does and does not claim.** It reports that a vein *exists*, where its centre is
 * and how far it extends. It does not generate blocks: whether any given position becomes ore also
 * depends on the block already there (`getStateToGenerate` returns null unless the position holds a
 * raw rock the vein's table can replace), which needs real terrain — surface height and the
 * carvers. So `exposure` stays `'unknown'` and the block count below is explicitly a shape figure,
 * not a promise about what is in the ground. Same honesty rule as the disc port.
 *
 * **Verified.** `tests/parity/tfc-1.20-cluster-pipe.parity.test.ts` checks the rarity roll and the
 * X/Y/Z draws against golden values captured from the verbatim Java
 * (`tools/parity/capture-tfc-cluster-pipe.mjs`), and `tfc-1.20-metaballs.parity.test.ts` covers the
 * `Metaballs3D` shape this builds on. The chunk seed composition it starts from is verified by
 * `tfc-1.20-veins.parity.test.ts`, shared with the disc port. See docs/PARITY.md.
 *
 * What is still **not** claimed: which of those positions actually hold ore. That needs the block
 * already at each position, which needs terrain — see plan section 9.
 */
import { RAW_VEINS_BY_PROFILE as SHARED_VEIN_TABLES, type VeinProfileId } from './vein-tables';
import { blockToChunk } from '@core/coords/coords';
import type { BlockBox, DepositFeature } from '../../api/types';
import { biomeTagMembers, stripTagMarker } from './biome-tags';
import { chunkVeinRandom, defaultYPos, veinNameSeed } from './disc-vein';
import { centreOfMass3D, simpleMetaballs3D, type Metaballs3D } from './metaballs-3d';
import {
  bandIsAboveGround,
  collectRockNames,
  columnCanHost,
  hostRockIdsOf,
  veinMaterials,
} from './vein-materials';
import { parseIndicator } from './indicator';
import type { VeinIndicator } from '@worldgen/api/types';

interface RawBlockEntry {
  readonly block: string;
  readonly weight: number;
}

interface RawVein {
  readonly id?: string;
  readonly type?: string;
  readonly project?: boolean;
  readonly near_lava?: boolean;
  readonly random_name?: string;
  readonly size?: number;
  readonly density?: number;
  readonly rarity?: number;
  readonly min_y?: number;
  readonly max_y?: number;
  readonly biomes?: string;
  readonly indicator?: unknown;
  readonly blocks?: Readonly<Record<string, readonly RawBlockEntry[]>>;
}

export interface ClusterVeinDef {
  readonly id: string;
  /** The ore this vein is named for, as a display key. */
  readonly ore: string;
  readonly nameSeed: bigint;
  readonly size: number;
  readonly density: number;
  readonly rarity: number;
  readonly minY: number;
  readonly maxY: number;
  readonly biomeTag: string | null;
  readonly hostRock: string;
  /** The rocks this vein's table can replace — see `columnCanHost`. */
  readonly hostRockIds: ReadonlySet<string>;
  readonly hasIndicator: boolean;
  /**
   * `VeinConfig#projectToSurface`: this vein's Y range is relative to the surface, not to world
   * zero. 24 of TerraFirmaGreg's veins are projected, including every `surface_*` early-game ore.
   */
  readonly project: boolean;
  /** Parsed `Indicator`, or null when the vein defines none. */
  readonly indicator: VeinIndicator | null;
  /** Materials this vein places — see `veinMaterials`. */
  readonly produces: readonly string[];
}

const RAW_VEINS_BY_PROFILE = SHARED_VEIN_TABLES as unknown as Readonly<Record<VeinProfileId, Readonly<Record<string, RawVein>>>>;

/**
 * One vein's raw `blocks` table, for callers that need the weights rather than the parsed def
 * (the filter's material mix). Keyed by the vein's table id, which is every vein in the profile —
 * cluster, disc and pipe alike.
 */
export function rawVeinBlocks(
  profile: VeinProfileId,
  veinId: string,
): Readonly<Record<string, readonly RawBlockEntry[]>> | undefined {
  return RAW_VEINS_BY_PROFILE[profile][veinId]?.blocks;
}

/** The rock ids a vein's replacement table can host, as a readable list. */
function hostRockDescription(blocks: Readonly<Record<string, unknown>> | undefined): string {
  if (!blocks) return '';
  return Object.keys(blocks)
    .map((id) => id.split('/').at(-1) ?? id)
    .sort()
    .join(', ');
}

function buildClusterVeinDefs(profile: VeinProfileId): readonly ClusterVeinDef[] {
  const defs: ClusterVeinDef[] = [];
  // Rock names from the profile's *entire* vein table, not just this vein's -- see
  // `collectRockNames`.
  const rockNames = collectRockNames(
    Object.values(RAW_VEINS_BY_PROFILE[profile]).map((vein) => vein.blocks),
  );
  for (const [id, raw] of Object.entries(RAW_VEINS_BY_PROFILE[profile])) {
    if (raw.type !== 'cluster') continue;
    // `project: true` makes min_y/max_y offsets from the surface, not absolute world Y
    // (`VeinConfig#projectToSurface`, applied as `projectedY` in `VeinFeature#place`). These were
    // skipped entirely until surface height existed; they are now placed, with the offset applied
    // in `clusterDepositAt` from a `surfaceY` the caller supplies.
    // `near_lava: true` is an existence-level gate: a vein whose columns never touch lava places
    // zero blocks, so drawing it would be a marker for ore that is not there.
    if (raw.near_lava === true) continue;
    // A vein missing any of these is not placeable; skipping is correct, inventing a value is not.
    if (
      raw.random_name === undefined ||
      raw.size === undefined ||
      raw.density === undefined ||
      raw.rarity === undefined ||
      raw.min_y === undefined ||
      raw.max_y === undefined ||
      raw.rarity <= 0
    ) {
      continue;
    }
    defs.push({
      id,
      ore: `${profile === 'tfg' ? 'tfg' : 'tfc'}:${id}`,
      nameSeed: veinNameSeed(raw.random_name),
      size: raw.size,
      density: raw.density,
      rarity: raw.rarity,
      minY: raw.min_y,
      maxY: raw.max_y,
      // `stripTagMarker`, like the disc and pipe ports: the extracted field keeps the datapack's
      // '#' tag marker, and `biomeTagMembers` is indexed by the bare id. Without this every
      // tag-restricted cluster vein looked up a key that cannot exist and was dropped everywhere.
      biomeTag: raw.biomes ? stripTagMarker(raw.biomes) : null,
      hostRock: hostRockDescription(raw.blocks),
      hostRockIds: hostRockIdsOf(raw.blocks),
      hasIndicator: raw.indicator != null,
      project: raw.project === true,
      indicator: parseIndicator(raw.indicator ?? null),
      produces: veinMaterials(raw.blocks, rockNames),
    });
  }
  return defs;
}

const CLUSTER_VEINS_CACHE = new Map<VeinProfileId, readonly ClusterVeinDef[]>();

/** Every cluster vein this port can place for one profile, built once per profile. */
export function clusterVeinsFor(profile: VeinProfileId): readonly ClusterVeinDef[] {
  const cached = CLUSTER_VEINS_CACHE.get(profile);
  if (cached) return cached;
  const built = buildClusterVeinDefs(profile);
  CLUSTER_VEINS_CACHE.set(profile, built);
  return built;
}

/** TerraFirmaGreg's cluster veins — 49 of its 76, and every metal ore worth a trip. */
export const SUPPORTED_CLUSTER_VEINS: readonly ClusterVeinDef[] = clusterVeinsFor('tfg');

/**
 * `ClusterVeinConfig#chunkRadius`: how many chunks either side of a target chunk can hold a vein
 * whose blocks reach into it. A vein found `chunkRadius` chunks away still overlaps this box.
 */
export function clusterChunkRadius(size: number): number {
  return 1 + (size >> 4);
}

/**
 * One vein type in one chunk, or null when the rarity roll misses or the biome check rejects it.
 * Mirrors `VeinFeature#getVeinsAtChunk` + `ClusterVeinFeature#createVein`: rarity roll, then
 * `defaultPos` (X, Y, Z in that order), then the metaball. The metaball is built even though the
 * marker does not need its shape, because `Metaballs3D.simple` consumes the RNG the real feature
 * consumes — dropping it here would leave this stream out of step with the game's.
 */
export function findClusterVeinInChunk(
  worldSeed: bigint,
  vein: ClusterVeinDef,
  chunkX: number,
  chunkZ: number,
  biomeAt: (x: number, z: number, y: number) => string | null,
  tagMembers: (tag: string) => ReadonlySet<string> | undefined = biomeTagMembers,
  /**
   * Surface height, for `project: true` veins whose Y is relative to it. Returning `null` — a
   * profile with no height field — drops those veins rather than placing them at a fabricated
   * depth, which is what every profile did before surface height existed.
   */
  surfaceY?: (x: number, z: number) => number | null,
  /** The rock at a block position, for the replacement-table check. */
  rockAt?: (x: number, y: number, z: number) => string | null,
): { readonly deposit: DepositFeature; readonly shape: Metaballs3D } | null {
  const random = chunkVeinRandom(worldSeed, vein.nameSeed, chunkX, chunkZ);
  if (random.nextInt(vein.rarity) !== 0) return null;

  const originX = (chunkX << 4) + random.nextInt(16);
  const y = defaultYPos(vein.size, random, vein.minY, vein.maxY);
  const originZ = (chunkZ << 4) + random.nextInt(16);
  const shape = simpleMetaballs3D(random, vein.size);

  // The marker is where the ore is, not where the feature's `BlockPos` landed: the metaball body
  // sits a mean 5.2 blocks off the origin -- see `centreOfMass3D`. Everything the game's own
  // arithmetic depends on (the projected Y below, the RNG stream above) still uses the origin.
  const centre = centreOfMass3D(shape);
  const x = originX + Math.round(centre.x);
  const z = originZ + Math.round(centre.z);

  // `VeinFeature#place` computes `projectedY` per column from the OCEAN_FLOOR_WG heightmap and adds
  // it to every block's Y. A marker is one position, so the centre column's surface stands for the
  // whole vein; across a vein's own width the surface varies by a few blocks at most.
  let projectedY = 0;
  if (vein.project) {
    const surface = surfaceY?.(originX, originZ);
    if (surface === null || surface === undefined) return null;
    projectedY = surface;
  }

  if (vein.biomeTag !== null) {
    const members = tagMembers(vein.biomeTag);
    const biome = biomeAt(originX, originZ, y + projectedY);
    if (!members || biome === null || !members.has(biome)) return null;
  }

  // Nor if its band is entirely in the air above the terrain -- see `bandIsAboveGround`.
  if (bandIsAboveGround(y - vein.size + projectedY, surfaceY?.(x, z))) return null;

  // The vein exists in this chunk, but places nothing unless the rock in its band is in its table.
  if (
    !columnCanHost(
      vein.hostRockIds,
      x,
      z,
      y - vein.size + projectedY,
      y + vein.size + projectedY,
      rockAt,
    )
  ) {
    return null;
  }

  return {
    shape,
    deposit: {
      id: `${vein.id}@${chunkX},${chunkZ}`,
      kind: 'ore',
      ore: vein.ore,
      shape: 'cluster',
      x,
      z,
      // The metaball is bounded by the config size on every axis (`getBoundingBox`).
      topY: y + vein.size + projectedY,
      bottomY: y - vein.size + projectedY,
      surfaceY: null,
      depthBelowSurface: null,
      exposure: 'unknown',
      hostRock: vein.hostRock,
      hasIndicator: vein.hasIndicator,
      indicator: vein.indicator,
      // Needs surface height; `resolveDepositDepth` fills it in.
      indicatorReach: 'unknown',
      rarity: vein.rarity,
      size: vein.size,
      density: vein.density,
      // Computed once per vein type and cached, so only the first vein of each kind pays for it.
      typicalOreBlocks: typicalVeinBlocks(vein),
      produces: vein.produces,
    },
  };
}

/**
 * Every cluster vein overlapping `box`. The chunk range is widened by each vein's own
 * `chunkRadius`, because a vein centred outside the box still reaches into it — the same reason
 * `VeinFeature#getVeinsAtChunk` scans a radius around the target chunk rather than just the chunk.
 */
export function clusterDepositsInBox(
  box: BlockBox,
  worldSeed: bigint,
  biomeAt: (x: number, z: number, y: number) => string | null,
  veins: readonly ClusterVeinDef[] = SUPPORTED_CLUSTER_VEINS,
  surfaceY?: (x: number, z: number) => number | null,
  rockAt?: (x: number, y: number, z: number) => string | null,
): DepositFeature[] {
  const minChunkX = blockToChunk(box.minX);
  const maxChunkX = blockToChunk(box.maxX);
  const minChunkZ = blockToChunk(box.minZ);
  const maxChunkZ = blockToChunk(box.maxZ);

  const deposits: DepositFeature[] = [];
  for (const vein of veins) {
    const radius = clusterChunkRadius(vein.size);
    for (let chunkZ = minChunkZ - radius; chunkZ <= maxChunkZ + radius; chunkZ++) {
      for (let chunkX = minChunkX - radius; chunkX <= maxChunkX + radius; chunkX++) {
        const found = findClusterVeinInChunk(
          worldSeed,
          vein,
          chunkX,
          chunkZ,
          biomeAt,
          biomeTagMembers,
          surfaceY,
          rockAt,
        );
        if (found) deposits.push(found.deposit);
      }
    }
  }
  return deposits;
}

/**
 * A **typical** ore-block count for one vein type: the number of integer positions inside a
 * representative metaball, times the vein's density.
 *
 * Read this as "roughly this big", not as a count of what is in the ground at a given instance:
 *
 * - The shape is re-rolled per vein, so instances vary; this uses one fixed sample per type.
 * - `density` is the per-position probability, so the result is an expectation, not a total.
 * - The real feature also skips any position not already holding a replaceable raw rock, which
 *   needs terrain we have not ported. **The true count is therefore at most this number**, and
 *   lower wherever the vein overlaps air, water, a cave or a rock the vein cannot replace.
 *
 * Computed on first use per vein id and cached: one pass over a `(2*size+1)^3` box is ~10 ms for
 * the largest veins, fine on demand and far too slow to do for every marker on screen.
 */
const TYPICAL_BLOCKS = new Map<string, number>();

export function typicalVeinBlocks(vein: ClusterVeinDef, seed = 1234567n): number {
  const cached = TYPICAL_BLOCKS.get(vein.id);
  if (cached !== undefined) return cached;

  // A fixed, arbitrary chunk keeps this deterministic across sessions and machines.
  const random = chunkVeinRandom(seed, vein.nameSeed, 0, 0);
  const shape = simpleMetaballs3D(random, vein.size);
  let inside = 0;
  for (let x = -vein.size; x <= vein.size; x++) {
    for (let y = -vein.size; y <= vein.size; y++) {
      for (let z = -vein.size; z <= vein.size; z++) {
        if (shape.inside(x, y, z)) inside++;
      }
    }
  }
  const expected = Math.round(inside * vein.density);
  TYPICAL_BLOCKS.set(vein.id, expected);
  return expected;
}
