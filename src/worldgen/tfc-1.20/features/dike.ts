/**
 * Dikes — the pipe veins that place **raw rock** instead of ore, and rewrite the host rock where
 * they pass.
 *
 * TerraFirmaGreg's overworld adds three of them back from TFC's own data
 * (`tags.overworld.js`: `tfc:vein/granite_dike`, `diorite_dike`, `gabbro_dike`). Each is a tilted
 * cylinder 300 blocks tall and ~40 wide that converts every raw rock it crosses into granite,
 * diorite or gabbro. That matters far beyond cosmetics: several veins host **only** in those three
 * rocks — `deep_galena`, which Pau walked to twice and found nothing, is one — so in a province of
 * marble and chalk the only granite there will ever be is a dike.
 *
 * Measured against Pau's world before this existed: our rock model was **98.3% right on every rock
 * that is not granite, diorite or gabbro, and 79.2% on those three**. The gap was the dikes.
 *
 * ```java
 * // PipeVeinFeature#getChanceToGenerate, with (x, y, z) relative to the vein's own position
 * final double yScaled = (double) y / config.height();
 * x += vein.skew * vein.skewX * yScaled;
 * z += vein.skew * vein.skewZ * yScaled;
 * final double yFactor = (double) vein.sign * yScaled + 0.5D;
 * final double trueRadius = config.radius() * (1 - yFactor) + (config.radius() - vein.slant) * yFactor;
 * if (Math.abs(y) < config.height() && (x * x) + (z * z) < trueRadius * trueRadius) return density;
 * ```
 *
 * The `density` roll is deliberately **not** applied here. A dike is 0.98 dense, and the question a
 * caller asks is "can this vein's table replace what is here", which the dike answers for the body
 * as a whole; rolling per block would need the feature's own RNG stream at that position.
 */
import type { BlockBox } from '../../api/types';
import { blockToChunk } from '@core/coords/coords';
import { chunkVeinRandom, defaultYPos, type VeinProfileId } from './disc-vein';
import { allPipeVeinsFor, pipeChunkRadius, type PipeVeinDef } from './pipe-vein';

/**
 * `net.minecraft.util.Mth.sin`: a 65 536-entry table, not `Math.sin`. The difference is small but
 * it steers the dike's direction, and a dike is long enough for a small angle error to move its
 * body by tens of blocks at the far end.
 */
const SIN_TABLE = new Float32Array(65536);
for (let i = 0; i < 65536; i++) SIN_TABLE[i] = Math.sin((i * Math.PI * 2) / 65536);

function mthSin(value: number): number {
  return SIN_TABLE[Math.trunc(Math.fround(value * Math.fround(10430.378))) & 65535] ?? 0;
}

function mthCos(value: number): number {
  return SIN_TABLE[Math.trunc(Math.fround(value * Math.fround(10430.378) + 16384)) & 65535] ?? 0;
}

/** One placed dike, with the shape fields a marker does not need but a rock query does. */
export interface DikeInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sign: number;
  readonly skewX: number;
  readonly skewZ: number;
  readonly skew: number;
  readonly slant: number;
  readonly radius: number;
  readonly height: number;
  /** The rock this dike places, as a bare id (`granite`). */
  readonly rock: string;
}

/** `Helpers.uniform(random, int, int)`. */
function uniformInt(random: { nextInt(bound: number): number }, min: number, max: number): number {
  return min === max ? min : min + random.nextInt(max - min);
}

/** The bare rock a dike's replacement table writes, or `null` if it writes no plain rock. */
function dikeRockOf(vein: PipeVeinDef): string | null {
  for (const entries of Object.values(vein.rawBlocks ?? {})) {
    for (const entry of entries) {
      const block = entry.block ?? '';
      if (block.startsWith('tfc:rock/raw/')) return block.slice('tfc:rock/raw/'.length);
    }
  }
  return null;
}

/** The pipe veins of a profile that place raw rock rather than ore. */
export function dikeVeinsFor(profile: VeinProfileId): readonly PipeVeinDef[] {
  return allPipeVeinsFor(profile).filter((vein) => dikeRockOf(vein) !== null);
}

/**
 * `PipeVeinFeature#createVein` for one chunk, keeping the direction and lean. Shares the draw order
 * with `findPipeVeinInChunk` — see that file's header, the angle is drawn *first*.
 */
function findDikeInChunk(
  worldSeed: bigint,
  vein: PipeVeinDef,
  rock: string,
  chunkX: number,
  chunkZ: number,
): DikeInstance | null {
  const random = chunkVeinRandom(worldSeed, vein.nameSeed, chunkX, chunkZ);
  if (random.nextInt(vein.rarity) !== 0) return null;

  const angle = Math.fround(random.nextFloat() * Math.fround(Math.PI * 2));
  const x = (chunkX << 4) + random.nextInt(16);
  const y = defaultYPos(vein.height, random, vein.minY, vein.maxY);
  const z = (chunkZ << 4) + random.nextInt(16);
  const sign = vein.sign < random.nextFloat() ? 1 : -1;
  const skew = uniformInt(random, vein.minSkew, 1 + vein.maxSkew);
  const slant = uniformInt(random, vein.minSlant, 1 + vein.maxSlant);

  // A dike has no biome tag in TFC's data; if one ever appears, the caller's biome gate is the
  // place for it rather than a silent pass here.
  return {
    x,
    y,
    z,
    sign,
    skewX: mthCos(angle),
    skewZ: mthSin(angle),
    skew,
    slant,
    radius: vein.radius,
    height: vein.height,
    rock,
  };
}

/** Whether a block position lies inside a dike's body. */
export function dikeContains(dike: DikeInstance, x: number, y: number, z: number): boolean {
  let dx = x - dike.x;
  const dy = y - dike.y;
  let dz = z - dike.z;
  if (Math.abs(dy) >= dike.height) return false;

  const yScaled = dy / dike.height;
  dx += dike.skew * dike.skewX * yScaled;
  dz += dike.skew * dike.skewZ * yScaled;

  const yFactor = dike.sign * yScaled + 0.5;
  const trueRadius = dike.radius * (1 - yFactor) + (dike.radius - dike.slant) * yFactor;
  return dx * dx + dz * dz < trueRadius * trueRadius;
}

/**
 * Every dike whose body can reach into `box`, ready to be asked about a position.
 *
 * One pass per box rather than a lookup per query: a dike is rarity 300 per chunk, so a region-sized
 * box holds a handful, and the caller then scans that handful for each rock query.
 */
export function dikesInBox(
  box: BlockBox,
  worldSeed: bigint,
  profile: VeinProfileId,
): readonly DikeInstance[] {
  const out: DikeInstance[] = [];
  for (const vein of dikeVeinsFor(profile)) {
    const rock = dikeRockOf(vein);
    if (rock === null) continue;
    const radius = pipeChunkRadius(vein.radius + vein.maxSkew);
    const minChunkX = blockToChunk(box.minX) - radius;
    const maxChunkX = blockToChunk(box.maxX) + radius;
    const minChunkZ = blockToChunk(box.minZ) - radius;
    const maxChunkZ = blockToChunk(box.maxZ) + radius;
    for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
      for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        const dike = findDikeInChunk(worldSeed, vein, rock, chunkX, chunkZ);
        if (dike !== null) out.push(dike);
      }
    }
  }
  return out;
}

/**
 * What a *vein's* host-rock check should see at a position a dike passes through.
 *
 * Not the dike's rock, which is what the block physically is — a name no replacement table lists, so
 * the vein is dropped. TerraFirmaGreg adds the dikes at the **end** of `tfc:in_biome/veins`
 * ("Add back the non-ore ones"), so they decorate after the ore veins and overwrite whatever those
 * placed with plain rock. Measured against Pau's world, that is what the save shows: letting a dike
 * *grant* host rock added 32 markers and 4 of them held ore — `surface_tetrahedrite` went from 9 of
 * 9 to 9 of 19. Treating it as a veto scores 90.5% against 90.0%.
 *
 * `dikeRockAt` remains the honest answer for anything that wants the rock itself, such as a probe.
 */
export const DIKE_OVERWRITES = 'dike';

/** The dike rock at a position, or `null` when no dike passes through it. */
export function dikeRockAt(
  dikes: readonly DikeInstance[],
  x: number,
  y: number,
  z: number,
): string | null {
  for (const dike of dikes) {
    if (dikeContains(dike, x, y, z)) return dike.rock;
  }
  return null;
}
