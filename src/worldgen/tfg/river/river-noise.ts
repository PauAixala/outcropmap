/**
 * River valleys for the `tfg` profile — a port of `TFGRiverNoise` (TerraFirmaGreg Core 0.9.21,
 * `world/new_ow_wg/rivers/`).
 *
 * A river does not sit on the surrounding land's height: the game carves a valley whose shape comes
 * from the biomes around the column. TerraFirmaGreg wrote its own set of eleven shapes where TFC has
 * five — banked, floodplain, talus and terraces are its additions — so TFC's carver cannot be reused
 * with a translated biome table.
 *
 * Until this existed, the `tfg` profile carved nothing at all, and a column in `tfg:earth/river` came
 * out **15.04 blocks too high** measured against Pau's save, against under 2.8 for every other biome.
 * That is the single largest error in our surface height, and surface height positions every
 * `project: true` vein's band.
 *
 * ## Only the height half is ported
 *
 * Each Java sampler has two methods: `setColumnAndSampleHeight`, which is the surface, and `noise`,
 * which reshapes the 3D density for overhangs and cave mouths. The map reports a surface, so only
 * the first is here. `tallCanyon`'s `OpenSimplex3D` cliff noise and `cave`'s column noise belong to
 * the second and are deliberately absent — they change what the walls look like, not how high the
 * ground is.
 *
 * ## The seeds are a sequence, and the order is the data
 *
 * `TFCChunkGeneratorMixin.tfg$createRiverSamplersForChunk` builds one sampler per enum constant,
 * **in declaration order, from a single `Seed`**, and every `OpenSimplex2D` inside takes
 * `seed.next()` — a fresh `XoroshiroRandomSource(worldSeed).nextLong()` each time. Get the order or
 * the count of draws wrong and every valley in the world is shaped by the wrong noise. `NONE`
 * consumes none. The order lives in `@data/tfg/biome-rivers.json` next to the biome table, both
 * extracted by `tools/extract-tfg-river-types.mjs`.
 *
 * @unverified No JVM fixture. Checked against a real save by measurement — see docs/PARITY.md.
 */
import { XoroshiroRandomSource } from '@core/random/xoroshiro';
import { OpenSimplex2D } from '@worldgen/tfc-1.20/noise/open-simplex-2d';
// The Java here is all `double` arithmetic, so these are the double overloads of Mth, not the
// float ones in `region/mth.ts`.
import { clamp, clampedMap, lerp, mapRange } from '@worldgen/tfc-1.20/noise/noise2d';
import type { RiverInfo } from '@worldgen/tfc-1.20/river/river-height';
import riverData from '@data/tfg/biome-rivers.json';

const SEA_LEVEL_Y = 63;

/** `Seed.next()`: sequential draws from one `XoroshiroRandomSource(worldSeed)`. */
class SeedSequence {
  private readonly random: XoroshiroRandomSource;
  constructor(worldSeed: bigint) {
    this.random = XoroshiroRandomSource.fromSeed(worldSeed);
  }
  next(): bigint {
    return this.random.nextLong();
  }
}

type Field = (x: number, z: number) => number;

/** `new OpenSimplex2D(seed).octaves(n).spread(s)`, the base every sampler starts from. */
function base(seed: bigint, octaves: number | null, spread: number): Field {
  const noise = new OpenSimplex2D(seed);
  if (octaves !== null) noise.octaves(octaves);
  noise.spread(Math.fround(spread));
  return (x, z) => noise.noise(x, z);
}

/** `Noise2D.scaled(oldMin, oldMax, min, max)` — an affine map on the output. */
function scaled(field: Field, oldMin: number, oldMax: number, min: number, max: number): Field {
  const scale = (max - min) / (oldMax - oldMin);
  const shift = min - oldMin * scale;
  return (x, z) => field(x, z) * scale + shift;
}

/** `Noise2D.scaled(min, max)`, which is `scaled(-1, 1, min, max)`. */
function scaled2(field: Field, min: number, max: number): Field {
  return scaled(field, -1, 1, min, max);
}

function abs(field: Field): Field {
  return (x, z) => Math.abs(field(x, z));
}

function clamped(field: Field, min: number, max: number): Field {
  return (x, z) => clamp(field(x, z), min, max);
}

/**
 * One valley shape's surface height.
 *
 * `thisWeight` is the blend weight of this shape at the column and `caveWeight` the river-cave
 * weight before the cave bias was applied — both are arguments the Java passes and two of the
 * samplers read.
 */
export type RiverHeightSampler = (
  info: RiverInfo,
  x: number,
  z: number,
  heightIn: number,
  caveWeight: number,
  thisWeight: number,
) => number;

/** `RiverInfo.normDistSq`: 0 at the centre of the river, ~1 at its edge. */
function normDistSq(info: RiverInfo): number {
  return info.distSq / info.widthSq;
}

function banked(seed: SeedSequence): RiverHeightSampler {
  const distNoise = scaled2(base(seed.next(), 3, 0.05), -0.2, 0.2);
  const bankCutNoise = scaled(
    abs(base(seed.next(), 3, 0.025)),
    0,
    1,
    SEA_LEVEL_Y - 4,
    SEA_LEVEL_Y + 30,
  );
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * Math.fround(0.8) + distNoise(x, z);
    const riverHeight = 57 + (distFac < 1 ? distFac * 6 : 6);
    const heightInWeight = clamp(distFac - 1, 0, 2);
    const riverWeight = 2 - heightInWeight;
    return Math.min((heightIn * heightInWeight + riverHeight * riverWeight) / 2, bankCutNoise(x, z));
  };
}

function tallBanked(seed: SeedSequence): RiverHeightSampler {
  const distNoise = scaled2(base(seed.next(), 3, 0.05), -0.2, 0.2);
  const surfaceNoise = scaled2(base(seed.next(), 4, 0.07), -2, 2);
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * Math.fround(0.8) + distNoise(x, z);
    const riverHeight = 57 + (distFac < 1 ? distFac * 9 : 9) + surfaceNoise(x, z);
    const heightInWeight = clamp(distFac - 1, 0, 2);
    const riverWeight = 2 - heightInWeight;
    return (heightIn * heightInWeight + riverHeight * riverWeight) / 2;
  };
}

function floodplain(seed: SeedSequence): RiverHeightSampler {
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.2, 0.2);
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * Math.fround(0.8) + distNoise(x, z);
    let riverHeight: number;
    if (distFac < 1) {
      riverHeight = 58.5 + distFac * 3;
    } else if (distFac < 2) {
      riverHeight = 61.5;
    } else {
      const heightInWeight = clamp(2 * distFac - 4, 0, 1);
      riverHeight = 61.5 * (1 - heightInWeight) + heightIn * heightInWeight;
    }
    return Math.min(riverHeight, heightIn);
  };
}

/** `wide` and `wideDeep` differ only in the base height, 58 against 55. */
function vShaped(seed: SeedSequence, floor: number): RiverHeightSampler {
  const baseNoise = scaled2(base(seed.next(), 4, 0.05), -2.5, 1.5);
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.15, 0.15);
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * Math.fround(0.8) + distNoise(x, z);
    return Math.min(floor + distFac * 7 + baseNoise(x, z), heightIn);
  };
}

function canyon(seed: SeedSequence): RiverHeightSampler {
  const baseNoise = scaled2(base(seed.next(), 4, 0.05), -7, 3);
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.3, 0.2);
  const lowFreqCliffNoise = clamped(base(seed.next(), null, 0.0007), 0, 1);
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * 1.3 + distNoise(x, z);
    const adjDistFac = distFac > 0.6 ? distFac * 0.4 + 0.8 : distFac;
    const riverHeight =
      55 + lerp(lowFreqCliffNoise(x, z), distFac, adjDistFac) * 16 + baseNoise(x, z);
    return Math.min(riverHeight, heightIn);
  };
}

function tallCanyon(seed: SeedSequence): RiverHeightSampler {
  const baseNoise = scaled2(base(seed.next(), 4, 0.05), -7, 3);
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.3, 0.2);
  // The third draw is the OpenSimplex3D cliff noise, which only the 3D `noise()` half uses. The
  // draw still has to happen, or every sampler built after this one is seeded wrong.
  seed.next();
  return (info, x, z, heightIn) => {
    const distFac = normDistSq(info) * 1.3 + distNoise(x, z);
    const adjDistFac = distFac > 0.32 ? distFac * 0.2 + 1.6 : distFac;
    return Math.min(55 + adjDistFac * 16 + baseNoise(x, z), heightIn);
  };
}

function talus(seed: SeedSequence): RiverHeightSampler {
  const baseNoise = scaled2(base(seed.next(), 4, 0.05), -2.5, 1.5);
  const cliffHeightNoise = scaled2(base(seed.next(), 2, 0.1), 3, 8);
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.15, 0.15);
  return (info, x, z, heightIn, _caveWeight, thisWeight) => {
    const dist = normDistSq(info);
    const distFac = Math.sqrt(dist) + distNoise(x, z);
    const talusHeight =
      55 + distFac * 12 + baseNoise(x, z) + (distFac > 1.5 ? cliffHeightNoise(x, z) : 0);
    const canyonHeight = 55 + dist * 1.3 * 16;
    // Near the edge of a talus biome it falls back to canyon-like noise, or the two shapes tear.
    const riverHeight = clampedMap(thisWeight, 0.9, 1, canyonHeight, talusHeight);
    return Math.min(riverHeight, heightIn);
  };
}

function terraces(seed: SeedSequence): RiverHeightSampler {
  const baseNoise = scaled2(base(seed.next(), 4, 0.05), -2.5, 1.5);
  const cliffHeightNoise = scaled2(base(seed.next(), 2, 0.1), 4, 8);
  const cliffBaseNoise = scaled2(base(seed.next(), 2, 0.06), SEA_LEVEL_Y - 2, SEA_LEVEL_Y + 4);
  const distNoise = scaled2(base(seed.next(), 4, 0.05), -0.15, 0.15);
  return (info, x, z, heightIn, _caveWeight, thisWeight) => {
    const dist = normDistSq(info);
    const distFac = Math.sqrt(dist) * 0.85 + distNoise(x, z);
    const sloped = 54 + distFac * 12 + baseNoise(x, z);
    const cliffBase = cliffBaseNoise(x, z);
    const cliff = cliffHeightNoise(x, z);
    const lower =
      sloped > cliffBase ? clampedMap(sloped, cliffBase, cliffBase + 1.1, 0, cliff) : 0;
    const upper =
      sloped > cliffBase + cliff
        ? clampedMap(sloped, cliffBase + cliff, cliffBase + cliff + 1.4, 0, cliff + 4)
        : 0;
    const terraceHeight = sloped + lower + upper;
    const canyonHeight = 55 + dist * 1.3 * 16;
    const riverHeight = clampedMap(thisWeight, 0.9, 1, canyonHeight, terraceHeight);
    return Math.min(riverHeight, heightIn);
  };
}

function cave(seed: SeedSequence): RiverHeightSampler {
  const carvingCenterNoise = scaled2(base(seed.next(), 2, 0.02), SEA_LEVEL_Y - 3, SEA_LEVEL_Y + 3);
  const carvingHeightNoise = scaled2(base(seed.next(), 4, 0.15), 8, 14);
  return (info, x, z, heightIn, caveWeight) => {
    // Fully subterranean: the surface is simply the land's, the river runs under it.
    if (caveWeight > 0.75) return heightIn;

    const dist = normDistSq(info);
    const canyonMaxHeight = Math.min(55 + dist * 1.3 * 16, heightIn);
    if (caveWeight <= 0.5) return canyonMaxHeight;

    const maxHeight = carvingCenterNoise(x, z) + carvingHeightNoise(x, z);
    const interior = mapRange(caveWeight, 0.5, 0.75, Math.min(maxHeight, heightIn), heightIn);
    const exterior = mapRange(caveWeight, 0.5, 0.75, Math.min(canyonMaxHeight, heightIn), heightIn);
    return lerp(clamp(dist * 1.3 - 0.1, 0, 1), interior, exterior);
  };
}

/** Enum order, and the number of `Seed.next()` draws each shape takes, are both load-bearing. */
const FACTORIES: Readonly<Record<string, ((seed: SeedSequence) => RiverHeightSampler) | null>> = {
  NONE: null,
  BANKED: banked,
  TALL_BANKED: tallBanked,
  FLOODPLAIN: floodplain,
  WIDE: (seed) => vShaped(seed, 58),
  WIDE_DEEP: (seed) => vShaped(seed, 55),
  CANYON: canyon,
  TALL_CANYON: tallCanyon,
  TALUS: talus,
  TERRACES: terraces,
  CAVE: cave,
};

interface RiverData {
  readonly order: readonly string[];
  readonly biomes: Readonly<Record<string, string>>;
}

const DATA = riverData as unknown as RiverData;

/** The index of the `NONE` and `CAVE` shapes, which the blend treats specially. */
export const RIVER_TYPE_NONE = DATA.order.indexOf('NONE');
export const RIVER_TYPE_CAVE = DATA.order.indexOf('CAVE');
export const RIVER_TYPE_COUNT = DATA.order.length;

/** `tfg:earth/plains` -> the index of its valley shape in `order`. */
export function riverTypeIndexOf(biomeId: string): number {
  const bare = biomeId.slice(biomeId.lastIndexOf('/') + 1);
  const type = DATA.biomes[bare];
  const index = type === undefined ? -1 : DATA.order.indexOf(type);
  return index < 0 ? RIVER_TYPE_NONE : index;
}

/**
 * One sampler per shape, built in enum order from one seed sequence — see this file's header.
 * `NONE` has no sampler; the blend uses the unmodified height for its weight.
 */
export function createRiverHeightSamplers(
  worldSeed: bigint,
): readonly (RiverHeightSampler | null)[] {
  const seed = new SeedSequence(worldSeed);
  return DATA.order.map((type) => FACTORIES[type]?.(seed) ?? null);
}
