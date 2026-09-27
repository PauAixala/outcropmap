/**
 * Pipe veins — `net.dries007.tfc.world.feature.vein.PipeVeinFeature` (TFC 1.20.x).
 *
 * A tilted, tapering cylinder rather than a blob, and **the shape every gem uses**: diamond and
 * emerald on TFC, sapphire, lapis/lazurite and bismuth on TerraFirmaGreg. Until this port they were
 * simply absent from the map, which is what "are there missing ores?" turned up.
 *
 * ```java
 * protected Vein createVein(WorldGenerationContext context, int chunkX, int chunkZ, RandomSource random, PipeVeinConfig config) {
 *     final float angle = random.nextFloat() * (float) Math.PI * 2;
 *     return new Vein(
 *         defaultPos(chunkX, chunkZ, random, config),
 *         config.sign() < random.nextFloat() ? 1 : -1,
 *         Mth.cos(angle), Mth.sin(angle),
 *         Helpers.uniform(random, config.minSkew(), 1 + config.maxSkew()),
 *         Helpers.uniform(random, config.minSlant(), 1 + config.maxSlant()));
 * }
 *
 * protected BoundingBox getBoundingBox(PipeVeinConfig config, Vein vein) {
 *     final int radius = config.radius(), skew = vein.skew;
 *     return new BoundingBox(-radius - skew, -config.height(), -radius - skew, radius + skew, config.height(), radius + skew);
 * }
 *
 * // PipeVeinConfig
 * public int chunkRadius()    { return 1 + (radius >> 4); }
 * public int verticalRadius() { return height; }
 * ```
 *
 * **The draw order is not the argument order.** `angle` is computed on the line *before* the
 * constructor call, so `nextFloat()` for the angle comes first, then `defaultPos`'s three draws,
 * then the `nextFloat()` the sign is compared against, then the two `uniform` calls. Reading the
 * constructor arguments left to right would put the angle in the wrong place and shift every
 * subsequent value — the kind of mistake that still produces perfectly plausible output.
 *
 * `Helpers.uniform(random, int, int)` is `min == max ? min : min + nextInt(max - min)`, so a vein
 * whose `min_skew` equals `1 + max_skew` consumes no draw at all.
 *
 * A note on the Java: `PipeVeinConfig.CODEC` declares
 * `Codec.INT.fieldOf("height").forGetter(c -> c.radius)` — the *getter* for height returns radius.
 * That is a serialisation-side bug in TFC and does not affect reading a datapack, so this port uses
 * the `height` field as written in the JSON. Do not "fix" it to match the getter.
 *
 * Like the other vein ports this reports existence, centre and extent only — not blocks. Exposure
 * stays `'unknown'` until plan section 9.
 *
 * **Verified.** `tests/parity/tfc-1.20-cluster-pipe.parity.test.ts` pins the draw order described
 * above against golden values from the verbatim Java, along with the position and the `skew` the
 * reported width depends on. See docs/PARITY.md. As with the other vein ports, this establishes
 * *where* a vein is, not which of its positions hold ore.
 */
import { RAW_VEINS_BY_PROFILE as SHARED_VEIN_TABLES } from './vein-tables';
import { blockToChunk } from '@core/coords/coords';
import type { BlockBox, DepositFeature } from '../../api/types';
import { biomeTagMembers, stripTagMarker } from './biome-tags';
import { chunkVeinRandom, defaultYPos, veinNameSeed, type VeinProfileId } from './disc-vein';
import { collectRockNames, columnCanHost, hostRockIdsOf, veinMaterials } from './vein-materials';
import { parseIndicator } from './indicator';
import type { VeinIndicator } from '@worldgen/api/types';

interface RawVein {
  readonly id?: string;
  readonly type?: string;
  readonly random_name?: string;
  readonly rarity?: number;
  readonly density?: number;
  readonly min_y?: number;
  readonly max_y?: number;
  readonly height?: number;
  readonly radius?: number;
  readonly min_skew?: number;
  readonly max_skew?: number;
  readonly min_slant?: number;
  readonly max_slant?: number;
  readonly sign?: number;
  readonly biomes?: string;
  readonly project?: boolean;
  readonly near_lava?: boolean;
  readonly indicator?: unknown;
  readonly blocks?: Readonly<Record<string, readonly { readonly block: string }[]>>;
}

export interface PipeVeinDef {
  readonly id: string;
  readonly ore: string;
  readonly nameSeed: bigint;
  readonly rarity: number;
  readonly density: number;
  readonly minY: number;
  readonly maxY: number;
  readonly height: number;
  readonly radius: number;
  readonly minSkew: number;
  readonly maxSkew: number;
  readonly minSlant: number;
  readonly maxSlant: number;
  readonly sign: number;
  readonly biomeTag: string | null;
  readonly hostRock: string;
  /** The rocks this vein's table can replace — see `columnCanHost`. */
  readonly hostRockIds: ReadonlySet<string>;
  readonly hasIndicator: boolean;
  /** Parsed `Indicator`, or null when the vein defines none. */
  readonly indicator: VeinIndicator | null;
  readonly produces: readonly string[];
  /** The vein's replacement table as extracted — `dike.ts` reads it to find the rock a dike places. */
  readonly rawBlocks: RawVein['blocks'];
}

const RAW_BY_PROFILE = SHARED_VEIN_TABLES as unknown as Readonly<Record<VeinProfileId, Readonly<Record<string, RawVein>>>>;

function hostRockDescription(blocks: RawVein['blocks']): string {
  if (!blocks) return '';
  return Object.keys(blocks)
    .map((id) => id.split('/').at(-1) ?? id)
    .sort()
    .join(', ');
}

function build(profile: VeinProfileId): readonly PipeVeinDef[] {
  const defs: PipeVeinDef[] = [];
  // Rock names from the profile's *entire* vein table, not just this vein's -- see
  // `collectRockNames`.
  const rockNames = collectRockNames(
    Object.values(RAW_BY_PROFILE[profile]).map((vein) => vein.blocks),
  );
  for (const [id, raw] of Object.entries(RAW_BY_PROFILE[profile])) {
    if (raw.type !== 'pipe') continue;
    // Same exclusions as every other vein port -- surface-relative Y and the lava gate cannot be
    // evaluated without terrain (docs/PLAN.md section 9).
    if (raw.project === true || raw.near_lava === true) continue;
    if (
      raw.random_name === undefined ||
      raw.rarity === undefined ||
      raw.rarity <= 0 ||
      raw.density === undefined ||
      raw.min_y === undefined ||
      raw.max_y === undefined ||
      raw.height === undefined ||
      raw.radius === undefined ||
      raw.min_skew === undefined ||
      raw.max_skew === undefined ||
      raw.min_slant === undefined ||
      raw.max_slant === undefined ||
      raw.sign === undefined
    ) {
      // A pipe vein missing a shape field cannot be placed. Skipping is correct; defaulting a
      // radius or a sign would invent a shape the game does not generate.
      continue;
    }
    defs.push({
      id,
      ore: `${profile === 'tfg' ? 'tfg' : 'tfc'}:${raw.random_name}`,
      nameSeed: veinNameSeed(raw.random_name),
      rarity: raw.rarity,
      density: raw.density,
      minY: raw.min_y,
      maxY: raw.max_y,
      height: raw.height,
      radius: raw.radius,
      minSkew: raw.min_skew,
      maxSkew: raw.max_skew,
      minSlant: raw.min_slant,
      maxSlant: raw.max_slant,
      sign: raw.sign,
      biomeTag: raw.biomes ? stripTagMarker(raw.biomes) : null,
      hostRock: hostRockDescription(raw.blocks),
      hostRockIds: hostRockIdsOf(raw.blocks),
      hasIndicator: raw.indicator != null,
      indicator: parseIndicator(raw.indicator ?? null),
      produces: veinMaterials(raw.blocks, rockNames),
      rawBlocks: raw.blocks,
    });
  }
  return defs;
}

const CACHE = new Map<VeinProfileId, readonly PipeVeinDef[]>();

/**
 * Every pipe vein a profile defines, **including the ones that place plain rock** — the dikes.
 * `dike.ts` wants those; the map does not, so `pipeVeinsFor` below leaves them out.
 */
export function allPipeVeinsFor(profile: VeinProfileId): readonly PipeVeinDef[] {
  const cached = CACHE.get(profile);
  if (cached) return cached;
  const built = build(profile);
  CACHE.set(profile, built);
  return built;
}

/**
 * The pipe veins worth a marker: those that place an ore. A dike places raw granite, diorite or
 * gabbro and nothing else, so drawing it as a deposit would promise an ore that does not exist —
 * its real effect on the map is on the *host rock*, through `dike.ts`.
 */
export function pipeVeinsFor(profile: VeinProfileId): readonly PipeVeinDef[] {
  return allPipeVeinsFor(profile).filter((vein) => vein.produces.length > 0);
}

/**
 * A **typical** ore-block count for one pipe vein type: positions inside the tilted, tapering
 * cylinder, times the vein's density.
 *
 * `PipeVeinFeature#getChanceToGenerate` (TFC 1.20.x):
 *
 * ```java
 * final double yScaled = (double) y / config.height();
 * x += vein.skew * vein.skewX * yScaled;
 * z += vein.skew * vein.skewZ * yScaled;
 * final double yFactor = (double) vein.sign * yScaled + 0.5D;
 * final double trueRadius = config.radius() * (1 - yFactor) + (config.radius() - vein.slant) * yFactor;
 * if (Math.abs(y) < config.height() && (x * x) + (z * z) < trueRadius * trueRadius) return density;
 * ```
 *
 * Read it as "roughly this big", with the same caveats as the cluster and disc estimators: it is an
 * expectation, not a total, and the real feature only replaces raw rock, so **the true count is at
 * most this number**.
 *
 * Averaged over several rolls rather than taken from one, because a pipe's shape varies far more
 * between instances than a cluster's — `skew` is drawn from 7..20 and `slant` from 2..5 in every
 * TerraFirmaGreg pipe, and both change the volume. The rolls come from the real draw order, so the
 * sampled shapes are shapes the game actually makes.
 */
const TYPICAL_PIPE_BLOCKS = new Map<string, number>();
const PIPE_SAMPLES = 8;

export function typicalPipeVeinBlocks(vein: PipeVeinDef, seed = 1234567n): number {
  const cached = TYPICAL_PIPE_BLOCKS.get(vein.id);
  if (cached !== undefined) return cached;

  let total = 0;
  for (let sample = 0; sample < PIPE_SAMPLES; sample++) {
    // Fixed, arbitrary chunks: deterministic across sessions, and each one draws a different shape.
    const random = chunkVeinRandom(seed, vein.nameSeed, sample, sample * 7);
    const angle = random.nextFloat() * Math.PI * 2;
    random.nextInt(16);
    defaultYPos(vein.height, random, vein.minY, vein.maxY);
    random.nextInt(16);
    const sign = vein.sign < random.nextFloat() ? 1 : -1;
    const skew = uniformInt(random, vein.minSkew, 1 + vein.maxSkew);
    const slant = uniformInt(random, vein.minSlant, 1 + vein.maxSlant);

    const skewX = Math.fround(Math.cos(angle));
    const skewZ = Math.fround(Math.sin(angle));
    const reach = vein.radius + skew;
    let inside = 0;
    for (let y = -vein.height; y <= vein.height; y++) {
      if (Math.abs(y) >= vein.height) continue;
      const yScaled = y / vein.height;
      const yFactor = sign * yScaled + 0.5;
      const trueRadius = vein.radius * (1 - yFactor) + (vein.radius - slant) * yFactor;
      if (trueRadius <= 0) continue;
      const radiusSq = trueRadius * trueRadius;
      const offsetX = skew * skewX * yScaled;
      const offsetZ = skew * skewZ * yScaled;
      for (let x = -reach; x <= reach; x++) {
        const dx = x + offsetX;
        const dxSq = dx * dx;
        if (dxSq >= radiusSq) continue;
        for (let z = -reach; z <= reach; z++) {
          const dz = z + offsetZ;
          if (dxSq + dz * dz < radiusSq) inside++;
        }
      }
    }
    total += inside * vein.density;
  }

  const expected = Math.round(total / PIPE_SAMPLES);
  TYPICAL_PIPE_BLOCKS.set(vein.id, expected);
  return expected;
}

/** `PipeVeinConfig#chunkRadius`. Note this uses `radius`, not `size` — pipes have no `size`. */
export function pipeChunkRadius(radius: number): number {
  return 1 + (radius >> 4);
}

/** `Helpers.uniform(RandomSource, int, int)`. Consumes no draw when the bounds are equal. */
function uniformInt(random: { nextInt(bound?: number): number }, min: number, max: number): number {
  return min === max ? min : min + random.nextInt(max - min);
}

/** One pipe vein in one chunk, or null when the rarity roll misses or the biome check rejects it. */
export function findPipeVeinInChunk(
  worldSeed: bigint,
  vein: PipeVeinDef,
  chunkX: number,
  chunkZ: number,
  biomeAt: (x: number, z: number, y: number) => string | null,
  tagMembers: (tag: string) => ReadonlySet<string> | undefined = biomeTagMembers,
  /** The rock at a block position, for the replacement-table check. */
  rockAt?: (x: number, y: number, z: number) => string | null,
): DepositFeature | null {
  const random = chunkVeinRandom(worldSeed, vein.nameSeed, chunkX, chunkZ);
  if (random.nextInt(vein.rarity) !== 0) return null;

  // Draw order: the angle is computed before the constructor call -- see this file's header.
  random.nextFloat(); // angle; the marker does not need the direction, but the draw must happen
  const x = (chunkX << 4) + random.nextInt(16);
  // `verticalRadius()` is `height` for a pipe, unlike disc and cluster which pass `size`.
  const y = defaultYPos(vein.height, random, vein.minY, vein.maxY);
  const z = (chunkZ << 4) + random.nextInt(16);
  random.nextFloat(); // compared against `sign` to pick which way the pipe leans
  const skew = uniformInt(random, vein.minSkew, 1 + vein.maxSkew);
  uniformInt(random, vein.minSlant, 1 + vein.maxSlant); // slant: tapering, not needed for the marker

  if (vein.biomeTag !== null) {
    const members = tagMembers(vein.biomeTag);
    const biome = biomeAt(x, z, y);
    if (!members || biome === null || !members.has(biome)) return null;
  }

  // The vein exists in this chunk, but places nothing unless the rock in its band is in its table.
  if (
    !columnCanHost(vein.hostRockIds, x, z, y - vein.height, y + vein.height, rockAt)
  ) {
    return null;
  }

  return {
    id: `${vein.id}@${chunkX},${chunkZ}`,
    kind: 'ore',
    ore: vein.ore,
    shape: 'pipe',
    x,
    z,
    // `getBoundingBox` is +/- height vertically and +/- (radius + skew) horizontally.
    topY: y + vein.height,
    bottomY: y - vein.height,
    surfaceY: null,
    depthBelowSurface: null,
    exposure: 'unknown',
    hostRock: vein.hostRock,
    hasIndicator: vein.hasIndicator,
      indicator: vein.indicator,
      // Needs surface height; `resolveDepositDepth` fills it in.
      indicatorReach: 'unknown',
    rarity: vein.rarity,
    density: vein.density,
    blocksAcross: (vein.radius + skew) * 2 + 1,
    blocksTall: vein.height * 2 + 1,
    produces: vein.produces,
  };
}

/** Every pipe vein overlapping `box`, widened by each vein's own chunk radius. */
export function pipeDepositsInBox(
  box: BlockBox,
  worldSeed: bigint,
  biomeAt: (x: number, z: number, y: number) => string | null,
  veins: readonly PipeVeinDef[],
  rockAt?: (x: number, y: number, z: number) => string | null,
): DepositFeature[] {
  const minChunkX = blockToChunk(box.minX);
  const maxChunkX = blockToChunk(box.maxX);
  const minChunkZ = blockToChunk(box.minZ);
  const maxChunkZ = blockToChunk(box.maxZ);

  const deposits: DepositFeature[] = [];
  for (const vein of veins) {
    const radius = pipeChunkRadius(vein.radius);
    for (let chunkZ = minChunkZ - radius; chunkZ <= maxChunkZ + radius; chunkZ++) {
      for (let chunkX = minChunkX - radius; chunkX <= maxChunkX + radius; chunkX++) {
        const deposit = findPipeVeinInChunk(
          worldSeed,
          vein,
          chunkX,
          chunkZ,
          biomeAt,
          biomeTagMembers,
          rockAt,
        );
        if (deposit) deposits.push(deposit);
      }
    }
  }
  return deposits;
}
