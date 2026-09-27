/**
 * Disc-vein placement: `net.dries007.tfc.world.feature.vein.VeinFeature`/`DiscVeinFeature`,
 * TFC 1.20.x (checkout b158c9c, see src/data/tfc-1.20/veins.json's `_meta.git_commit`). Covers
 * `tfc:disc_vein` and the `kaolin_disc` variant (`KaolinDiscVeinFeature` extends `DiscVeinFeature`
 * without overriding placement -- only block-replacement/chance-to-generate, which this port never
 * simulates -- see this file's header further down). Cluster and pipe veins are out of scope
 * (CLAUDE.md's brief for this phase); see docs/WORLDGEN-NOTES.md's "Ore veins" section.
 *
 * Fixture-verified against the real, unmodified TFC method bodies (not a reimplementation guess):
 * tests/parity/tfc-1.20-veins.parity.test.ts, tests/fixtures/tfc-1.20/veins.json,
 * tools/parity/capture-tfc-veins.mjs.
 *
 * ---- Seeding (the part that must be exact) ----
 *
 * `VeinFeature#getVeinsAtChunk(WorldGenLevel level, WorldGenerationContext context, int
 * chunkPosX, int chunkPosZ, List<V> veins, C config, Function<BlockPos, Holder<Biome>>
 * biomeQuery)`:
 *
 *   final RandomSource random = new XoroshiroRandomSource(
 *       level.getSeed() ^ chunkPosX * 61728364132L,
 *       config.config().seed() ^ chunkPosZ * 16298364123L);
 *   if (random.nextInt(config.config().rarity()) == 0) {
 *       final V vein = createVein(context, chunkPosX << 4, chunkPosZ << 4, random, config);
 *       if (config.canSpawnAt(vein.pos(), biomeQuery)) veins.add(vein);
 *   }
 *
 * One fresh `XoroshiroRandomSource` per (vein type, chunk) -- not shared across chunks or across
 * vein types -- seeded from the world seed folded with the chunk X coordinate (`lo`) and the
 * vein's own per-datapack-entry seed folded with the chunk Z coordinate (`hi`). `config.config()
 * .seed()` is `VeinConfig#hash(random_name)` computed once when the vein's JSON loads, not per
 * chunk -- see `veinNameSeed` below.
 *
 * ---- Position (`DiscVeinFeature`) ----
 *
 * `createVein` -> `defaultPosRespectingHeight(chunkX, chunkZ, random, config)`:
 *
 *   return new BlockPos(chunkX + random.nextInt(16), defaultYPos(config.size(), random, config),
 *       chunkZ + random.nextInt(16));
 *
 * Evaluation order matters: Java evaluates constructor arguments left to right against the same
 * `RandomSource`, so the draw order is X, then (maybe) Y, then Z -- see `discVeinPosition` below.
 * The vertical shrink range passed to `defaultYPos` is `config.size()` (the disc's horizontal
 * radius), NOT `config.height()` (its vertical thickness) -- a real quirk of the Java source
 * (`DiscVeinConfig#verticalRadius()` also returns `size`, so this is consistent within TFC, not a
 * typo this port is preserving by mistake). Every disc vein in the extracted data has
 * `height <= size` (checked against src/data/tfc-1.20/veins.json), so this never lets the disc's
 * vertical extent (`pos.y +/- height`) escape `[minY, maxY]`.
 *
 * `VeinFeature#defaultYPos(int verticalShrinkRange, RandomSource random, C config)`:
 *
 *   final int actualRange = config.maxY() - config.minY() - 2 * verticalShrinkRange;
 *   if (actualRange > 0) return config.minY() + verticalShrinkRange + random.nextInt(actualRange);
 *   else return (config.minY() + config.maxY()) / 2;
 *
 * Java integer division truncates toward zero (`Math.trunc`, not `Math.floor`) -- see CLAUDE.md
 * section 2.
 *
 * ---- What this port deliberately does NOT compute ----
 *
 * `createVein` also builds a `Metaballs2D` shape (`Metaballs2D.simple(random, config.size())`),
 * consuming further draws from the same `RandomSource` -- but only *after* `vein.pos()` is fully
 * determined (Java evaluates `new Vein(defaultPosRespectingHeight(...), Metaballs2D.simple(...))`
 * left to right), and nothing in `getVeinsAtChunk` reads `random` again afterward. The metaball
 * shape governs exactly which blocks within the disc's bounding box actually turn into ore --
 * irrelevant to a map marker reporting the vein's existence, centre and Y range, so this port
 * never draws those extra random values. Block-level replacement (`getStateToGenerate`,
 * `getChanceToGenerate`) is skipped for the same reason.
 *
 * ---- Surface-relative veins: NOT placed here ----
 *
 * Three of the eleven `disc` veins in the extracted data -- `bituminous_coal`, `halite`,
 * `lignite` -- set `project: true`/`project_offset: true`
 * (`VeinConfig#projectToSurface`/`#projectOffset`): their real placement Y is
 * `(a value in [min_y, max_y]) + realSurfaceHeightAtThatColumn`
 * (`VeinFeature#place`'s `projectedY`), i.e. `min_y`/`max_y` are depth-below/above-surface
 * offsets for these three, not absolute world Y, contrary to this phase's original assumption
 * (see docs/WORLDGEN-NOTES.md's "Ore veins" section for the correction). Now that surface height
 * is ported, they are placed at that offset from the profile's surface (`vein.project` below).
 * Their chunk existence, X/Z and biome restriction never depended on surface height; only the
 * final Y does (see `VeinFeature#place`).
 *
 * ---- near_lava veins: NOT placed here either ----
 *
 * `VeinConfig#nearLava` (`"near_lava": true` in the source JSON, currently only `sulfur`,
 * rarity 4) gates ore placement per-column inside `VeinFeature#place` (`isNearLava` check): a
 * column that is not near lava gets ZERO ore blocks from that vein, and a vein whose whole
 * bounding box never touches lava places nothing at all. This is an existence-level restriction,
 * exactly like the biome-tag check above -- not a per-block colour/rock-type detail this port
 * already accepts skipping (see "What this port deliberately does NOT compute" below). Unlike the
 * biome tag, there is no lava/cave data anywhere in this project to evaluate it against, so a
 * vein with `near_lava: true` cannot be
 * placed without either guessing "yes" (which is how FEEDBACK.md's 2026-09-07 "carpet" bug
 * happened: sulfur's rarity 4 with no biome restriction and no lava check produced roughly one
 * marker every 4 chunks, ~65x kaolin's own density, in a 512x512-block sample -- see
 * tests/unit/tfc-1.20-disc-vein.test.ts's plausibility test) or guessing "no" -- both fabricate an
 * answer this port cannot back up. `SUPPORTED_DISC_VEINS` excludes any `near_lava: true` vein
 * (`buildDiscVeinDefs` below): drawing a marker this port cannot verify is worse than drawing none.
 */
import { blockToChunk } from '@core/coords/coords';
import { toInt64 } from '@core/math';
import { seedFromHashOf, XoroshiroLimbs, multiplyLong } from '@core/random';
import type { RandomSource } from '@core/random';
import type { BlockBox, ClimateSample, DepositFeature } from '../../api/types';
import {
  RAW_VEINS_BY_PROFILE as SHARED_VEIN_TABLES,
  type VeinProfileId,
} from './vein-tables';
import { biomeTagMembers, stripTagMarker } from './biome-tags';
import { centreOfMass2D, clampedMap, simpleMetaballs2D } from './metaballs-2d';
import {
  bandIsAboveGround,
  collectRockNames,
  columnCanHost,
  hostRockIdsOf,
  veinMaterials,
} from './vein-materials';
import { parseIndicator } from './indicator';
import type { VeinIndicator } from '@worldgen/api/types';
import { projectOffset } from './project-offset';

/** Raw shape of one entry in `src/data/tfc-1.20/veins.json`'s `veins` map -- see
 * `tools/extract-datapack.mjs`'s `extractVeins` for exactly which Java field each key mirrors. */
interface RawVein {
  readonly id: string;
  readonly type: string;
  readonly rarity: number | null;
  readonly size: number | null;
  readonly height?: number;
  readonly density: number | null;
  readonly min_y: number | null;
  readonly max_y: number | null;
  readonly random_name: string | null;
  readonly blocks: Readonly<Record<string, readonly { readonly block: string }[]>>;
  readonly biomes?: string;
  readonly indicator?: unknown;
  readonly project?: boolean;
  readonly project_offset?: boolean;
  readonly near_lava?: boolean;
}


/** A disc vein this port can place: every field it needs, resolved once at module load rather
 * than re-parsed per chunk query. */
export interface DiscVeinDef {
  readonly id: string;
  /** `tfc:${random_name}` -- the real per-vein family id (e.g. 'tfc:kaolin' for the JSON entry
   * `kaolin_disc`, whose `random_name` is `'kaolin'`), not the JSON entry's own key. */
  readonly ore: string;
  readonly kind: 'ore' | 'mineral';
  readonly rarity: number;
  readonly minY: number;
  readonly maxY: number;
  readonly size: number;
  readonly height: number;
  readonly density: number;
  readonly hasIndicator: boolean;
  /** `VeinConfig#projectToSurface`: this vein's Y range is relative to the surface. */
  readonly project: boolean;
  /**
   * `VeinConfig#projectOffset`: the surface is sampled at a deterministic offset column rather than
   * the vein's own. All three of TFC's projected discs set it; none of TFG's 25 do.
   */
  readonly projectOffset: boolean;
  /** Parsed `Indicator`, or null when the vein defines none. */
  readonly indicator: VeinIndicator | null;
  /** Stripped biome tag id (e.g. 'tfc:kaolin_clay_spawns_in'), or `null` for no restriction. */
  readonly biomeTag: string | null;
  /** See `DepositFeature.hostRock`'s doc comment -- the eligible rock list, not a per-instance
   * guess. Empty string for kaolin (bypasses rock replacement). */
  readonly hostRock: string;
  /** The rocks this vein's table can replace — see `columnCanHost`. */
  readonly hostRockIds: ReadonlySet<string>;
  /** `VeinConfig#hash(random_name)`, computed once (see `veinNameSeed`'s doc comment) -- reused
   * by every chunk query for this vein instead of re-hashing the name every time. */
  readonly nameSeed: bigint;
  /** Materials this vein places — see `veinMaterials`. Answers "which vein has silver?". */
  readonly produces: readonly string[];
}

/** `net.dries007.tfc.world.feature.vein.VeinConfig#hash(String)`:
 *   RandomSupport.Seed128bit seed128 = RandomSupport.seedFromHashOf(name);
 *   return seed128.seedLo() ^ seed128.seedHi();
 * `seedFromHashOf` (MD5 of the UTF-8 name -- see `@core/random`'s `xoroshiro.ts`) is already
 * fixture-verified against a real captured Minecraft server run
 * (tests/fixtures/core/xoroshiro.json's `positionalFactoryFromHashOf` cases,
 * tests/parity/xoroshiro.parity.test.ts); this is the one-line XOR TFC composes it with. */
export function veinNameSeed(randomName: string): bigint {
  const seed = seedFromHashOf(randomName);
  return toInt64(seed.lo ^ seed.hi);
}

function hostRockDescription(blocks: Readonly<Record<string, unknown>>): string {
  const ids = Object.keys(blocks)
    .map((id) => id.split('/').pop() ?? id)
    .sort();
  return [...new Set(ids)].join(', ');
}

/**
 * Vein tables are per profile: TFC and TerraFirmaGreg ship different disc sets, and TFG's are
 * mostly GregTech metal ores (`normal_copper`, `normal_iron`, `normal_gold`) rather than TFC's
 * evaporites and gems. Reading one profile's table while generating another's world would place
 * veins that do not exist there — so the table is a parameter, never a module-level constant.
 */
export type { VeinProfileId };

const RAW_VEINS_BY_PROFILE = SHARED_VEIN_TABLES as unknown as Readonly<Record<VeinProfileId, Readonly<Record<string, RawVein>>>>;

function buildDiscVeinDefs(profile: VeinProfileId): readonly DiscVeinDef[] {
  const defs: DiscVeinDef[] = [];
  // Rock names from the profile's *entire* vein table, not just this vein's -- see
  // `collectRockNames`.
  const rockNames = collectRockNames(
    Object.values(RAW_VEINS_BY_PROFILE[profile]).map((vein) => vein.blocks),
  );
  for (const raw of Object.values(RAW_VEINS_BY_PROFILE[profile])) {
    if (raw.type !== 'disc' && raw.type !== 'kaolin_disc') continue;
    // "Surface-relative veins": min_y/max_y are offsets from the surface, not absolute Y. Skipped
    // entirely until surface height existed; now placed, with the offset applied below.
    // See this file's header, "near_lava veins" -- an existence-level gate this port has no data
    // to evaluate; drawing it anyway is exactly the "carpet" bug (FEEDBACK.md 2026-09-07).
    if (raw.near_lava === true) continue;
    if (
      raw.rarity === null ||
      raw.size === null ||
      raw.height === undefined ||
      raw.density === null ||
      raw.min_y === null ||
      raw.max_y === null ||
      raw.random_name === null
    ) {
      // Defensive only -- every disc/kaolin_disc entry in the extracted data has all of these;
      // a future TFC datapack change that drops one should skip that vein rather than place it
      // with a fabricated value.
      continue;
    }
    defs.push({
      id: raw.id,
      ore: `${profile === 'tfg' ? 'tfg' : 'tfc'}:${raw.random_name}`,
      // Classified per profile rather than per vein: TFC's disc set is evaporites, gems, fuels and
      // gravel (CLAUDE.md 1a's `minerals` layer), while every TFG vein is a GregTech ore. The block
      // ids do not separate the two -- TFG names salt and quartz `*_ore` as well -- so a per-vein
      // rule would be a guess.
      kind: profile === 'tfg' ? 'ore' : 'mineral',
      rarity: raw.rarity,
      minY: raw.min_y,
      maxY: raw.max_y,
      size: raw.size,
      height: raw.height,
      density: raw.density,
      hasIndicator: raw.indicator !== undefined,
      project: raw.project === true,
      projectOffset: raw.project_offset === true,
      indicator: parseIndicator(raw.indicator ?? null),
      biomeTag: raw.biomes ? stripTagMarker(raw.biomes) : null,
      hostRock: hostRockDescription(raw.blocks),
      hostRockIds: hostRockIdsOf(raw.blocks),
      nameSeed: veinNameSeed(raw.random_name),
      produces: veinMaterials(raw.blocks, rockNames),
    });
  }
  return defs;
}

const DISC_VEINS_CACHE = new Map<VeinProfileId, readonly DiscVeinDef[]>();

/** Every disc vein this port can place for one profile, built once per profile. */
export function discVeinsFor(profile: VeinProfileId): readonly DiscVeinDef[] {
  const cached = DISC_VEINS_CACHE.get(profile);
  if (cached) return cached;
  const built = buildDiscVeinDefs(profile);
  DISC_VEINS_CACHE.set(profile, built);
  return built;
}

/** TFC 1.20's disc veins. Kept as a named export because the parity tests are written against it. */
export const SUPPORTED_DISC_VEINS: readonly DiscVeinDef[] = discVeinsFor('tfc-1.20');

/**
 * `VeinFeature#getVeinsAtChunk`'s seed construction (see this file's header). `worldSeed` is
 * normalised through `toInt64` defensively: `WorldGenerator.seed` is a `bigint` with no enforced
 * range, and a Java `long` wraps at 64 bits on every operation, including the XOR below.
 */
// `61728364132L` and `16298364123L` as 32-bit limbs, computed once rather than written by hand.
const VEIN_X_HI = Number(BigInt.asUintN(32, 61728364132n >> 32n));
const VEIN_X_LO = Number(BigInt.asUintN(32, 61728364132n & 0xffffffffn));
const VEIN_Z_HI = Number(BigInt.asUintN(32, 16298364123n >> 32n));
const VEIN_Z_LO = Number(BigInt.asUintN(32, 16298364123n & 0xffffffffn));

const productLimbs = new Uint32Array(2);
/** The world seed as limbs, remembered across calls: it is the same for every vein in a request. */
let cachedWorldSeed: bigint | null = null;
let worldSeedHi = 0;
let worldSeedLo = 0;
/** Vein name seeds as limbs. Bounded by the number of vein types a profile has (76 for TFG). */
const nameSeedLimbs = new Map<bigint, readonly [number, number]>();

function nameLimbsOf(nameSeed: bigint): readonly [number, number] {
  const cached = nameSeedLimbs.get(nameSeed);
  if (cached) return cached;
  const limbs = [
    Number(BigInt.asUintN(32, nameSeed >> 32n)),
    Number(BigInt.asUintN(32, nameSeed & 0xffffffffn)),
  ] as const;
  nameSeedLimbs.set(nameSeed, limbs);
  return limbs;
}

/**
 * The per-(vein, chunk) generator, on 32-bit limbs.
 *
 * This is the hottest allocation in the whole deposit path: one generator per vein type per chunk,
 * and a region 512 blocks across carries ~1 300 chunks against 74 vein types — around 96 000 of
 * them. On the BigInt reference (`XoroshiroRandomSource`) that arithmetic and its garbage dominated
 * the profile, exactly as it did for the area layer stack in the round 3 work (docs/PLAN.md §6).
 * `XoroshiroLimbs` does the same maths with no BigInt at all; `tests/unit/vein-chunk-random.test.ts`
 * pins the two bit-for-bit, and the vein parity fixtures cover the placement built on it.
 */
export function chunkVeinRandom(
  worldSeed: bigint,
  nameSeed: bigint,
  chunkX: number,
  chunkZ: number,
): RandomSource {
  if (worldSeed !== cachedWorldSeed) {
    cachedWorldSeed = worldSeed;
    worldSeedHi = Number(BigInt.asUintN(32, worldSeed >> 32n));
    worldSeedLo = Number(BigInt.asUintN(32, worldSeed & 0xffffffffn));
  }
  const [nameHi, nameLo] = nameLimbsOf(nameSeed);

  // `worldSeed ^ (chunkX * 61728364132L)`, in Java's wrapping 64-bit arithmetic.
  multiplyLong(chunkX >> 31, chunkX | 0, VEIN_X_HI, VEIN_X_LO, productLimbs);
  const loHi = (worldSeedHi ^ productLimbs[0]!) >>> 0;
  const loLo = (worldSeedLo ^ productLimbs[1]!) >>> 0;

  // `nameSeed ^ (chunkZ * 16298364123L)`.
  multiplyLong(chunkZ >> 31, chunkZ | 0, VEIN_Z_HI, VEIN_Z_LO, productLimbs);
  const hiHi = (nameHi ^ productLimbs[0]!) >>> 0;
  const hiLo = (nameLo ^ productLimbs[1]!) >>> 0;

  const random = new XoroshiroLimbs();
  random.setState(loHi, loLo, hiHi, hiLo);
  return random;
}

/** `VeinFeature#defaultYPos` (see this file's header for the exact Java source and the
 * size-not-height quirk this deliberately preserves). */
export function defaultYPos(
  verticalShrinkRange: number,
  random: RandomSource,
  minY: number,
  maxY: number,
): number {
  const actualRange = maxY - minY - 2 * verticalShrinkRange;
  if (actualRange > 0) {
    return minY + verticalShrinkRange + random.nextInt(actualRange);
  }
  // Java int division truncates toward zero -- CLAUDE.md section 2.
  return Math.trunc((minY + maxY) / 2);
}

/**
 * `DiscVeinFeature#defaultPosRespectingHeight` (see this file's header for the draw order this
 * preserves: X, then Y -- which may or may not draw -- then Z, all against the same
 * `RandomSource`). `chunkOriginX`/`chunkOriginZ` are block coordinates of the chunk's minimum
 * corner (`chunkPosX << 4` in the Java source).
 */
export function discVeinPosition(
  random: RandomSource,
  chunkOriginX: number,
  chunkOriginZ: number,
  vein: DiscVeinDef,
): { readonly x: number; readonly y: number; readonly z: number } {
  const x = chunkOriginX + random.nextInt(16);
  const y = defaultYPos(vein.size, random, vein.minY, vein.maxY);
  const z = chunkOriginZ + random.nextInt(16);
  return { x, y, z };
}

/**
 * `VeinFeature#getVeinsAtChunk` for one vein type at one chunk (see this file's header for the
 * full method). Returns `null` when the rarity roll misses or the biome restriction rejects the
 * rolled position -- both real outcomes in the Java source, not an error.
 *
 * `biomeAt` mirrors `Function<BlockPos, Holder<Biome>> biomeQuery` (`level::getBiome` in the real
 * feature's call site) -- a plain `(x, z) => biome id or null` here since this port's biome
 * source (`WorldGenerator.biome`) is already column-based and string-keyed, unlike vanilla's
 * `Holder<Biome>`.
 */
export function findDiscVeinInChunk(
  worldSeed: bigint,
  vein: DiscVeinDef,
  chunkX: number,
  chunkZ: number,
  biomeAt: (x: number, z: number, y: number) => string | null,
  tagMembers: (tag: string) => ReadonlySet<string> | undefined = biomeTagMembers,
  /** Surface height, for `project: true` veins. Without it they are dropped, not guessed at. */
  surfaceY?: (x: number, z: number) => number | null,
  /** The rock at a block position, for the replacement-table check. */
  rockAt?: (x: number, y: number, z: number) => string | null,
): DepositFeature | null {
  const random = chunkVeinRandom(worldSeed, vein.nameSeed, chunkX, chunkZ);
  if (random.nextInt(vein.rarity) !== 0) return null;

  const origin = discVeinPosition(random, chunkX << 4, chunkZ << 4, vein);
  // `DiscVeinFeature#createVein` builds the footprint here, from the same random and in this order.
  // The marker follows the footprint's centre of mass rather than the rolled origin -- the ore is
  // what a player walks to. See `centreOfMass2D`.
  const footprint = centreOfMass2D(simpleMetaballs2D(random, vein.size));
  const pos = {
    x: origin.x + Math.round(footprint.x),
    y: origin.y,
    z: origin.z + Math.round(footprint.z),
  };

  if (vein.biomeTag !== null) {
    const members = tagMembers(vein.biomeTag);
    const biome = biomeAt(origin.x, origin.z, origin.y);
    if (!members || biome === null || !members.has(biome)) return null;
  }

  // `VeinFeature#place`: a projected vein's Y is relative to the surface, sampled at a
  // deterministic offset column when `projectOffset` is set.
  let projectedY = 0;
  if (vein.project) {
    const offset = vein.projectOffset
      ? projectOffset(origin.x, origin.y, origin.z)
      : { dx: 0, dz: 0 };
    const surface = surfaceY?.(origin.x + offset.dx, origin.z + offset.dz);
    if (surface === null || surface === undefined) return null;
    projectedY = surface;
  }

  // Nor if its band is entirely in the air above the terrain -- see `bandIsAboveGround`.
  if (bandIsAboveGround(pos.y - vein.height + projectedY, surfaceY?.(pos.x, pos.z))) return null;

  // The vein exists in this chunk, but places nothing unless the rock in its band is in its table.
  if (
    !columnCanHost(
      vein.hostRockIds,
      pos.x,
      pos.z,
      pos.y - vein.height + projectedY,
      pos.y + vein.height + projectedY,
      rockAt,
    )
  ) {
    return null;
  }

  const extent = discVeinExtent(vein);
  return {
    id: `${vein.id}@${chunkX},${chunkZ}`,
    kind: vein.kind,
    ore: vein.ore,
    shape: 'disc',
    x: pos.x,
    z: pos.z,
    topY: pos.y + vein.height + projectedY,
    bottomY: pos.y - vein.height + projectedY,
    // Surface height is not ported for this profile yet -- never guessed (CLAUDE.md 1a).
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
    // Kaolin reports its footprint instead of a block count -- see `discVeinExtent`.
    ...(extent.typicalOreBlocks === null ? {} : { typicalOreBlocks: extent.typicalOreBlocks }),
    footprintBlocks: extent.footprintBlocks,
    blocksAcross: extent.blocksAcross,
    blocksTall: extent.blocksTall,
    produces: vein.produces,
  };
}

/**
 * Every supported disc vein found in `box`, one deterministic pass over its chunk range.
 * `box`'s bounds are treated as inclusive block coordinates on both ends.
 */
export function discDepositsInBox(
  box: BlockBox,
  worldSeed: bigint,
  biomeAt: (x: number, z: number, y: number) => string | null,
  veins: readonly DiscVeinDef[] = SUPPORTED_DISC_VEINS,
  surfaceY?: (x: number, z: number) => number | null,
  rockAt?: (x: number, y: number, z: number) => string | null,
): DepositFeature[] {
  const minChunkX = blockToChunk(box.minX);
  const maxChunkX = blockToChunk(box.maxX);
  const minChunkZ = blockToChunk(box.minZ);
  const maxChunkZ = blockToChunk(box.maxZ);

  const deposits: DepositFeature[] = [];
  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      for (const vein of veins) {
        const deposit = findDiscVeinInChunk(
          worldSeed,
          vein,
          chunkX,
          chunkZ,
          biomeAt,
          biomeTagMembers,
          surfaceY,
          rockAt,
        );
        if (deposit) deposits.push(deposit);
      }
    }
  }
  return deposits;
}

/**
 * ClimatePlacement.isValid + placed_feature/vein/kaolin_disc.json: inclusive 18 C / 300 mm.
 * TFCChunkGenerator.applyBiomeDecoration evaluates placement at the target chunk's minimum
 * X/Z and minimum section Y (below sea level, so no elevation temperature adjustment).
 * VeinFeature.place clips nearby veins to each target chunk, not just the centre chunk.
 * Keep a candidate if ANY chunk intersecting its bounding box passes. Shape and replaceable
 * blocks are still unknown: this is necessary climate eligibility, not confirmed ore.
 * @unverified No JVM fixture for this combined placement stage yet; covered by unit tests.
 */
export function filterDiscDepositsByClimate(
  deposits: readonly DepositFeature[],
  climateAt: (x: number, z: number) => ClimateSample | null,
): DepositFeature[] {
  const kaolin = SUPPORTED_DISC_VEINS.find((vein) => vein.id === 'kaolin_disc');
  return deposits.filter((deposit) => {
    if (deposit.ore !== 'tfc:kaolin') return true;
    if (!kaolin) return false;
    for (
      let cz = blockToChunk(deposit.z - kaolin.size);
      cz <= blockToChunk(deposit.z + kaolin.size);
      cz++
    ) {
      for (
        let cx = blockToChunk(deposit.x - kaolin.size);
        cx <= blockToChunk(deposit.x + kaolin.size);
        cx++
      ) {
        const climate = climateAt(cx * 16, cz * 16);
        if (climate && climate.temperature >= 18 && climate.rainfall >= 300) return true;
      }
    }
    return false;
  });
}

/**
 * Footprint and thickness for one disc vein type, and — for ore discs only — a typical block count.
 *
 * **Kaolin deliberately gets no block count.** `KaolinDiscVeinFeature#getStateToGenerate` only
 * converts a position that already holds grass or a kaolin-replaceable soil, and soil is the top
 * handful of blocks of the terrain. A patch is 37 blocks across and 13 tall, but only the sliver of
 * it that intersects the surface soil layer ever becomes clay — and that layer is the soil cap,
 * which is not ported. Multiplying shape by density would produce a number
 * roughly an order of magnitude too large, presented with a confidence we have not earned
 * (CLAUDE.md section 2). What *is* honest, and is what a player choosing a patch actually wants, is
 * how wide the patch is on the ground.
 *
 * Ore discs are different: they replace raw rock, so most of a buried disc's volume qualifies, and
 * the same upper-bound reasoning as cluster veins applies.
 *
 * The `Metaballs2D` shape underneath is verified (`tests/parity/tfc-1.20-metaballs.parity.test.ts`
 * checks its ball tables, sampled magnitudes and exact footprint counts against real Java), so the
 * footprint figures here rest on confirmed geometry. The ore-block estimate remains an estimate for
 * the reasons above — density is a probability and the rock-replacement check needs terrain.
 */
export interface DiscVeinExtent {
  /** Widest span of the footprint in blocks, from the representative shape. */
  readonly blocksAcross: number;
  /** Footprint area in blocks, i.e. how many columns the patch covers. */
  readonly footprintBlocks: number;
  /** Full vertical extent, `2 * height + 1`. Exact, from extracted data. */
  readonly blocksTall: number;
  /** Expected ore blocks for an ore disc; `null` for kaolin — see above. */
  readonly typicalOreBlocks: number | null;
}

const DISC_EXTENTS = new Map<string, DiscVeinExtent>();

export function discVeinExtent(vein: DiscVeinDef, seed = 1234567n): DiscVeinExtent {
  const cached = DISC_EXTENTS.get(vein.id);
  if (cached !== undefined) return cached;

  const random = chunkVeinRandom(seed, vein.nameSeed, 0, 0);
  const shape = simpleMetaballs2D(random, vein.size);
  const isKaolin = vein.id === 'kaolin_disc';

  let footprint = 0;
  let minX = 0;
  let maxX = 0;
  let expected = 0;
  for (let x = -vein.size; x <= vein.size; x++) {
    for (let z = -vein.size; z <= vein.size; z++) {
      const sample = shape.sample(x, z);
      if (sample <= 1) continue;
      footprint++;
      if (footprint === 1 || x < minX) minX = x;
      if (footprint === 1 || x > maxX) maxX = x;
      if (isKaolin) continue;
      // DiscVeinFeature#getChanceToGenerate, summed over the column.
      const sampleFactor = clampedMap(sample, 2, 1, 1, 0.6);
      for (let y = -vein.height; y <= vein.height; y++) {
        expected +=
          vein.density *
          clampedMap(Math.abs(y - vein.height), 0.7 * vein.height, vein.height, 1.0, 0.4) *
          sampleFactor;
      }
    }
  }

  const extent: DiscVeinExtent = {
    blocksAcross: footprint === 0 ? 0 : maxX - minX + 1,
    footprintBlocks: footprint,
    blocksTall: vein.height * 2 + 1,
    typicalOreBlocks: isKaolin ? null : Math.round(expected),
  };
  DISC_EXTENTS.set(vein.id, extent);
  return extent;
}
