/**
 * Where TerraFirmaGreg's overworld structures start: villages, camps, mineshafts, ruins, towers.
 *
 * Three layers, with different standing:
 *
 * 1. **Placement** — `RandomSpreadStructurePlacement.getPotentialStructureChunk` with
 *    `WorldgenRandom.setLargeFeatureWithSalt`. Verified exactly: every one of the 145 structure
 *    starts in a real TFG save lands on the chunk this picks
 *    (tests/parity/tfg-world-structures.parity.test.ts).
 * 2. **Variant** — for a set with several structures, `ChunkGenerator.createStructures` tries them
 *    in a weighted order drawn from `setLargeFeatureSeed` until one generates. Checked against the
 *    same save.
 * 3. **Whether it generates** — `ClimatePlacement` for `tfc:climate` sets, the structure's biome tag,
 *    and the modpack's lithostitched spawn conditions. @unverified approximations, measured against
 *    the save and declared in docs/PARITY.md:
 *    - the biome is read at the chunk's minimum corner; the game reads it at the start piece's
 *      centre, which sits half a piece away (2–17 blocks, depending on the piece and rotation);
 *    - lithostitched's grid is sampled on a square lattice centred on that corner;
 *    - heightmap limits use the approximate surface height, with water counted at sea level for
 *      `WORLD_SURFACE_WG`.
 *
 * Pure computation: no DOM, runs in a worker and in Node.
 */
import { JavaRandom } from '@core/random';
import type { BlockBox, StructureFeature } from '@worldgen/api/types';
import rawData from '@data/tfg/structures.json';

export interface StructureContext {
  readonly seed: bigint;
  /** Biome registry id at a block, or null where the generator has none. */
  biomeAt(x: number, z: number): string | null;
  /** Chunk-data average temperature and rainfall at a block. */
  climateAt(x: number, z: number): { readonly temperature: number; readonly rainfall: number } | null;
  /** Chunk-data `ForestType` ordinal at a chunk. */
  forestAt(chunkX: number, chunkZ: number): number;
  /** Approximate terrain height at a block, or null. */
  surfaceY(x: number, z: number): number | null;
}

interface ClimateRule {
  readonly min_temperature?: number;
  readonly max_temperature?: number;
  readonly min_rainfall?: number;
  readonly max_rainfall?: number;
  readonly min_forest?: string;
  readonly max_forest?: string;
}

type Condition =
  | { readonly type: 'avoid_biomes'; readonly biomes: readonly string[]; readonly radius: number; readonly step: number; readonly allowedCount: number }
  | { readonly type: 'height'; readonly heightmap: string; readonly min: number; readonly max: number }
  | { readonly type: 'unsupported'; readonly raw: string };

interface StructureEntry {
  readonly id: string;
  readonly weight: number;
  readonly biomes: readonly string[];
  readonly conditions: readonly Condition[];
}

interface StructureSetEntry {
  readonly id: string;
  /** Which dimension's sets these are. A set is not portable: its structures name biomes that
   *  exist in one dimension only, so showing an overworld set on the Moon can only ever draw
   *  markers the game will not place. */
  readonly dimension: string;
  readonly placement: {
    readonly type: string;
    readonly salt: number;
    readonly spacing: number;
    readonly separation: number;
    readonly spreadType: string;
    readonly frequency?: number;
    readonly exclusionZone?: { readonly otherSet: string; readonly chunkCount: number };
    readonly climate?: ClimateRule;
  };
  readonly structures: readonly StructureEntry[];
}

const SETS = (rawData as unknown as { sets: StructureSetEntry[] }).sets;
const BIOME_SETS = new Map<string, ReadonlySet<string>>();
const biomeSet = (list: readonly string[]): ReadonlySet<string> => {
  const key = list.join(',');
  let set = BIOME_SETS.get(key);
  if (!set) {
    set = new Set(list);
    BIOME_SETS.set(key, set);
  }
  return set;
};

const FOREST_ORDINALS: Record<string, number> = { none: 0, sparse: 1, edge: 2, normal: 3, old_growth: 4 };
const SEA_LEVEL = 63;

/** Every overworld structure set this port places, for the UI's filter. */
export function tfgStructureSets(
  dimension?: string,
): readonly { readonly id: string; readonly structures: readonly string[] }[] {
  return SETS.filter((set) => dimension === undefined || set.dimension === dimension).map((set) => ({
    id: set.id,
    structures: set.structures.map((s) => s.id),
  }));
}

/** Dimensions this profile has structure sets for, so a generator can ask rather than assume. */
export function dimensionsWithStructures(): readonly string[] {
  return [...new Set(SETS.map((set) => set.dimension))];
}

/**
 * `RandomSpreadStructurePlacement.getPotentialStructureChunk`: the one chunk in `(chunkX, chunkZ)`'s
 * spacing cell where the set may start. `salt` is already the 32-bit int Minecraft decodes.
 */
export function potentialStructureChunk(
  seed: bigint,
  placement: { readonly salt: number; readonly spacing: number; readonly separation: number; readonly spreadType: string },
  chunkX: number,
  chunkZ: number,
): readonly [number, number] {
  const { spacing, separation } = placement;
  const cellX = Math.floor(chunkX / spacing);
  const cellZ = Math.floor(chunkZ / spacing);
  // `WorldgenRandom.setLargeFeatureWithSalt(seed, cellX, cellZ, salt)`.
  const random = new JavaRandom(
    BigInt.asIntN(64, BigInt(cellX) * 341873128712n + BigInt(cellZ) * 132897987541n + seed + BigInt(placement.salt)),
  );
  const range = spacing - separation;
  const offset = (): number =>
    placement.spreadType === 'triangular'
      ? Math.trunc((random.nextInt(range) + random.nextInt(range)) / 2)
      : random.nextInt(range);
  const offsetX = offset();
  const offsetZ = offset();
  return [cellX * spacing + offsetX, cellZ * spacing + offsetZ];
}

/**
 * The order `ChunkGenerator.createStructures` tries a multi-structure set's entries in:
 * `setLargeFeatureSeed(seed, chunkX, chunkZ)`, then repeated weighted picks without replacement.
 */
export function structureTryOrder<T extends { readonly weight: number }>(
  seed: bigint,
  entries: readonly T[],
  chunkX: number,
  chunkZ: number,
): T[] {
  if (entries.length <= 1) return [...entries];
  // `WorldgenRandom.setLargeFeatureSeed`: setSeed(seed); l = nextLong(); m = nextLong();
  // setSeed((long) x * l ^ (long) z * m ^ seed).
  const random = new JavaRandom(seed);
  const l = random.nextLong();
  const m = random.nextLong();
  random.setSeed(BigInt.asIntN(64, (BigInt(chunkX) * l) ^ (BigInt(chunkZ) * m) ^ seed));

  const remaining = [...entries];
  let total = remaining.reduce((sum, entry) => sum + entry.weight, 0);
  const order: T[] = [];
  while (remaining.length > 0) {
    let pick = random.nextInt(total);
    let index = 0;
    for (const entry of remaining) {
      pick -= entry.weight;
      if (pick < 0) break;
      index++;
    }
    const chosen = remaining[index]!;
    order.push(chosen);
    remaining.splice(index, 1);
    total -= chosen.weight;
  }
  return order;
}

/** `ClimatePlacement.isValid` at the chunk's minimum corner, y = 0 (so no elevation adjustment). */
function climateAllows(rule: ClimateRule, ctx: StructureContext, chunkX: number, chunkZ: number): boolean {
  const climate = ctx.climateAt(chunkX * 16, chunkZ * 16);
  if (!climate) return false;
  const { temperature, rainfall } = climate;
  const forest = ctx.forestAt(chunkX, chunkZ);
  return (
    (rule.min_temperature ?? -Infinity) <= temperature &&
    temperature <= (rule.max_temperature ?? Infinity) &&
    (rule.min_rainfall ?? -Infinity) <= rainfall &&
    rainfall <= (rule.max_rainfall ?? Infinity) &&
    (FOREST_ORDINALS[rule.min_forest ?? 'none'] ?? 0) <= forest &&
    forest <= (FOREST_ORDINALS[rule.max_forest ?? 'old_growth'] ?? 4)
  );
}

function conditionAllows(condition: Condition, ctx: StructureContext, x: number, z: number): boolean {
  switch (condition.type) {
    case 'avoid_biomes': {
      const avoid = biomeSet(condition.biomes);
      let count = 0;
      for (let dz = -condition.radius; dz <= condition.radius; dz += condition.step) {
        for (let dx = -condition.radius; dx <= condition.radius; dx += condition.step) {
          const biome = ctx.biomeAt(x + dx, z + dz);
          if (biome !== null && avoid.has(biome) && ++count > condition.allowedCount) return false;
        }
      }
      return true;
    }
    case 'height': {
      const ground = ctx.surfaceY(x, z);
      if (ground === null) return false;
      const height = condition.heightmap === 'WORLD_SURFACE_WG' ? Math.max(ground, SEA_LEVEL) : ground;
      return condition.min <= height && height <= condition.max;
    }
    default:
      // A condition this port cannot evaluate: never claim the structure is there.
      return false;
  }
}

/**
 * `StructurePlacement.ExclusionZone#isPlacementForbidden` — a set can be told to keep clear of
 * another set's placements.
 *
 * ```java
 * public boolean hasStructureChunkInRange(Holder<StructureSet> set, int x, int z, int range) {
 *     StructurePlacement placement = set.value().placement();
 *     for (int i = x - range; i <= x + range; i++)
 *         for (int j = z - range; j <= z + range; j++)
 *             if (placement.isStructureChunk(this, i, j)) return true;
 *     return false;
 * }
 * ```
 *
 * It is the other set's *placement* chunks that count, not whether anything actually generates
 * there — so this needs no biome or climate, and is exact wherever the other set is one we have.
 * No overworld set uses one, which is why it went unported; three of the Moon's four do, and
 * `cheese_ores` at spacing 3 would otherwise be drawn all over its meteor fields.
 *
 * An `otherSet` we do not have (the Beneath tower names vanilla's `minecraft:nether_complexes`)
 * cannot be evaluated. It is counted as "not forbidden" rather than dropping the set, and
 * `unevaluatedExclusions` names it so the gap is visible instead of silent.
 */
export const unevaluatedExclusions = new Set<string>();

function placementForbidden(set: StructureSetEntry, seed: bigint, chunkX: number, chunkZ: number): boolean {
  const zone = set.placement.exclusionZone;
  if (zone === undefined) return false;
  const other = SETS.find((candidate) => candidate.id === zone.otherSet);
  // `potentialStructureChunk` is the random-spread placement and nothing else. Vanilla's
  // strongholds are `concentric_rings`, and feeding those to it would not fail — it would return a
  // confident wrong chunk and forbid overworld placements that are verified exact today.
  if (other === undefined || other.placement.type !== 'minecraft:random_spread') {
    unevaluatedExclusions.add(`${set.id} -> ${zone.otherSet}`);
    return false;
  }
  const range = zone.chunkCount;
  for (let i = chunkX - range; i <= chunkX + range; i++) {
    for (let j = chunkZ - range; j <= chunkZ + range; j++) {
      const [ox, oz] = potentialStructureChunk(seed, other.placement, i, j);
      if (ox === i && oz === j) return true;
    }
  }
  return false;
}

/** The structure a set would start at a placement chunk, or null if none of its entries can. */
function generatedEntry(set: StructureSetEntry, ctx: StructureContext, chunkX: number, chunkZ: number): StructureEntry | null {
  if (set.placement.type === 'tfc:climate' && set.placement.climate && !climateAllows(set.placement.climate, ctx, chunkX, chunkZ)) {
    return null;
  }
  if (placementForbidden(set, ctx.seed, chunkX, chunkZ)) return null;
  const x = chunkX * 16;
  const z = chunkZ * 16;
  const biome = ctx.biomeAt(x, z);
  if (biome === null) return null;
  for (const entry of structureTryOrder(ctx.seed, set.structures, chunkX, chunkZ)) {
    if (!biomeSet(entry.biomes).has(biome)) continue;
    if (entry.conditions.every((condition) => conditionAllows(condition, ctx, x, z))) return entry;
  }
  return null;
}

/**
 * Why a placement chunk does or does not produce a structure: the first gate that rejects it.
 * For tests and tuning only; `structuresInBox` is the real entry point.
 */
export function diagnosePlacement(
  setId: string,
  ctx: StructureContext,
  chunkX: number,
  chunkZ: number,
): { gate: 'ok' | 'climate' | 'biome' | 'condition' | 'exclusion' | 'unknown-set'; detail: string } {
  const set = SETS.find((candidate) => candidate.id === setId);
  if (!set) return { gate: 'unknown-set', detail: setId };
  if (set.placement.type === 'tfc:climate' && set.placement.climate) {
    if (!climateAllows(set.placement.climate, ctx, chunkX, chunkZ)) {
      const c = ctx.climateAt(chunkX * 16, chunkZ * 16);
      return {
        gate: 'climate',
        detail: `t=${c?.temperature.toFixed(2)} r=${c?.rainfall.toFixed(1)} forest=${ctx.forestAt(chunkX, chunkZ)} rule=${JSON.stringify(set.placement.climate)}`,
      };
    }
  }
  if (placementForbidden(set, ctx.seed, chunkX, chunkZ)) {
    return { gate: 'exclusion', detail: set.placement.exclusionZone?.otherSet ?? '' };
  }
  const x = chunkX * 16;
  const z = chunkZ * 16;
  const biome = ctx.biomeAt(x, z);
  const inTag = set.structures.filter((entry) => biome !== null && biomeSet(entry.biomes).has(biome));
  if (inTag.length === 0) return { gate: 'biome', detail: `${biome}` };
  for (const entry of inTag) {
    const failed = entry.conditions.find((condition) => !conditionAllows(condition, ctx, x, z));
    if (!failed) return { gate: 'ok', detail: entry.id };
    if (entry === inTag[inTag.length - 1]) return { gate: 'condition', detail: `${failed.type} ${JSON.stringify(failed).slice(0, 80)}` };
  }
  return { gate: 'condition', detail: '' };
}

/** Every structure start whose chunk intersects `box`. */
export function structuresInBox(
  box: BlockBox,
  ctx: StructureContext,
  dimension: string = 'overworld',
): StructureFeature[] {
  const minChunkX = Math.floor(box.minX / 16);
  const maxChunkX = Math.floor(box.maxX / 16);
  const minChunkZ = Math.floor(box.minZ / 16);
  const maxChunkZ = Math.floor(box.maxZ / 16);
  const out: StructureFeature[] = [];
  for (const set of SETS) {
    if (set.dimension !== dimension) continue;
    const { spacing } = set.placement;
    for (let cellZ = Math.floor(minChunkZ / spacing); cellZ <= Math.floor(maxChunkZ / spacing); cellZ++) {
      for (let cellX = Math.floor(minChunkX / spacing); cellX <= Math.floor(maxChunkX / spacing); cellX++) {
        const [chunkX, chunkZ] = potentialStructureChunk(ctx.seed, set.placement, cellX * spacing, cellZ * spacing);
        if (chunkX < minChunkX || chunkX > maxChunkX || chunkZ < minChunkZ || chunkZ > maxChunkZ) continue;
        const entry = generatedEntry(set, ctx, chunkX, chunkZ);
        if (!entry) continue;
        out.push({
          id: `${set.id}@${chunkX},${chunkZ}`,
          type: entry.id,
          x: chunkX * 16 + 8,
          z: chunkZ * 16 + 8,
        });
      }
    }
  }
  return out;
}
