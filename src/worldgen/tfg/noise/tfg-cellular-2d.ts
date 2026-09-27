/**
 * Version-pinned port of Core Modern 0.9.21's TFGCellular2D.
 *
 * TFG keeps TFC's FastNoiseLite hash, jitter table, F1/F2 search and unsigned long seed fold,
 * but adds a configurable lattice sample radius and exposes the nearest point's diamond angle.
 * The loop deliberately preserves the Java implementation's integer and float boundaries,
 * including its xPrimed/yPrimed origin when sample is greater than one.
 */
import type { Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';
import {
  fastFloor,
  fastMax,
  fastMin,
  hash2D,
  longSeedToInt32Unsigned,
  PRIME_X,
  PRIME_Y,
  RAND_VECS_2D,
} from '@worldgen/tfc-1.20/noise/fast-noise-lite';
import { toFloat32 } from '@core/math';

const DEFAULT_JITTER = Math.fround(0.43701595);
const INV_2_31_FLOAT = Math.fround(1 / 2147483648);

export interface TFGCell {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly f1: number;
  readonly f2: number;
  readonly noise: number;
  readonly angle: number;
}

function diamondAngle(x: number, y: number): number {
  if (y >= 0) return x >= 0 ? y / (x + y) : 1 - x / (-x + y);
  return x < 0 ? 2 - y / (-x - y) : 3 + x / (x - y);
}

export class TFGCellular2D {
  private readonly seed: number;
  private readonly jitter: number;
  private readonly sample: number;
  private frequency = 1;

  constructor(seed: bigint, sample?: number);
  constructor(seed: bigint, jitter: number, sample: number);
  constructor(seed: bigint, jitterOrSample = DEFAULT_JITTER, sample = 1) {
    this.seed = longSeedToInt32Unsigned(seed);
    if (arguments.length === 2) {
      this.jitter = DEFAULT_JITTER;
      this.sample = jitterOrSample;
    } else {
      this.jitter = toFloat32(jitterOrSample);
      this.sample = sample;
    }
  }

  noise(x: number, y: number): number {
    return this.cell(x, y).noise;
  }

  spread(scaleFactor: number): this {
    this.frequency *= scaleFactor;
    return this;
  }

  then(f: (cell: TFGCell) => number): Noise2D {
    return (x, y) => f(this.cell(x, y));
  }

  cell(x: number, y: number): TFGCell {
    x *= this.frequency;
    y *= this.frequency;
    const xr = fastFloor(x);
    const yr = fastFloor(y);
    let distance0 = Number.MAX_VALUE;
    let distance1 = Number.MAX_VALUE;
    let angle0 = -1;
    let closestCenterX = 0;
    let closestCenterY = 0;
    let closestHash = 0;
    let closestCellX = 0;
    let closestCellY = 0;
    let xPrimed = Math.imul(xr - 1, PRIME_X);
    const yPrimedBase = Math.imul(yr - 1, PRIME_Y);

    for (let xi = xr - this.sample; xi <= xr + this.sample; xi++) {
      let yPrimed = yPrimedBase;
      for (let yi = yr - this.sample; yi <= yr + this.sample; yi++) {
        const hash = hash2D(this.seed, xPrimed, yPrimed);
        const idx = hash & (255 << 1);
        const vecX = xi + toFloat32(RAND_VECS_2D[idx] ?? 0) * this.jitter;
        const vecY = yi + toFloat32(RAND_VECS_2D[idx | 1] ?? 0) * this.jitter;
        const dx = vecX - x;
        const dy = vecY - y;
        const newDistance = dx * dx + dy * dy;
        distance1 = fastMax(fastMin(distance1, newDistance), distance0);
        if (newDistance < distance0) {
          distance0 = newDistance;
          angle0 = diamondAngle(dx, dy);
          closestHash = hash;
          closestCenterX = vecX;
          closestCenterY = vecY;
          closestCellX = xi;
          closestCellY = yi;
        }
        yPrimed = (yPrimed + PRIME_Y) | 0;
      }
      xPrimed = (xPrimed + PRIME_X) | 0;
    }

    return {
      x: closestCenterX / this.frequency,
      y: closestCenterY / this.frequency,
      cx: closestCellX,
      cy: closestCellY,
      f1: distance0,
      f2: distance1,
      noise: Math.fround(closestHash * INV_2_31_FLOAT),
      angle: angle0,
    };
  }
}
