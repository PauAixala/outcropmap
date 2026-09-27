/**
 * `net.dries007.tfc.world.noise.Cellular2D`: TFC's own cellular/Worley noise wrapper, used to
 * partition the world into region cells (`RegionGenerator.cellNoise`). Reimplements the F1/F2
 * search loop itself — bypassing `FastNoiseLite.SingleCellular` entirely — directly against
 * `FastNoiseLite.Hash` and `FastNoiseLite.RandVecs2D` (both ported in `./fast-noise-lite`), with
 * jitter `0.43701595f` and `CellularDistanceFunction.EuclideanSq` (squared Euclidean distance —
 * TFC never changes FastNoiseLite's default). The overall distance/centre math is double precision
 * (the class holds no `FastNoiseLite` instance and never narrows its own locals to `float`), but
 * `RandVecs2D` is still a Java `float[]` — each table lookup is narrowed with `toFloat32` before
 * the double-precision jitter multiply, matching `(float) RandVecs2D[idx] * JITTER` widening a
 * *rounded* float rather than the table literal's full double precision.
 */
import type { Noise2D } from './noise2d';
import { PRIME_X, PRIME_Y, RAND_VECS_2D, fastFloor, fastMax, fastMin, hash2D, longSeedToInt32Unsigned } from './fast-noise-lite';
import { toFloat32 } from '@core/math';

/** `Cellular2D.JITTER`: declared `double JITTER = 0.43701595f` — a float literal widened to
 * double, so the stored value is the float-rounded constant, not the double literal's own nearest
 * representation. */
const JITTER = Math.fround(0.43701595);

/** `Cellular2D.Cell` record: `(x, y)` is the jittered cell centre in the *unscaled* (pre-frequency)
 * coordinate space; `(cx, cy)` is the integer lattice cell; `f1`/`f2` are the nearest and
 * second-nearest squared distances; `noise` is a `[-1, 1)` value derived from the closest point's
 * hash. */
export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly f1: number;
  readonly f2: number;
  readonly noise: number;
}

const INV_2_31 = 1 / 2147483648;

/** `Cellular2D.cell(double x, double y)`. */
function cellAt(seed: number, frequency: number, x: number, z: number): Cell {
  const sx = x * frequency;
  const sz = z * frequency;

  const xr = fastFloor(sx);
  const yr = fastFloor(sz);

  let distance0 = Number.POSITIVE_INFINITY;
  let distance1 = Number.POSITIVE_INFINITY;
  let closestCenterX = 0;
  let closestCenterY = 0;
  let closestHash = 0;
  let closestCellX = 0;
  let closestCellY = 0;

  let xPrimed = Math.imul(xr - 1, PRIME_X);
  const yPrimedBase = Math.imul(yr - 1, PRIME_Y);

  for (let xi = xr - 1; xi <= xr + 1; xi++) {
    let yPrimed = yPrimedBase;
    for (let yi = yr - 1; yi <= yr + 1; yi++) {
      const hash = hash2D(seed, xPrimed, yPrimed);
      const idx = hash & (255 << 1);

      // `RandVecs2D` is a Java `float[]`; the table below is written as double literals for
      // readability, so each entry must be narrowed to float32 before use — `(float)
      // RandVecs2D[idx] * JITTER` widens the already-rounded float to double, which is not always
      // the same double as `RAND_VECS_2D[idx] * JITTER` computed from the full-precision literal
      // (same class of bug as `gradCoord2D`'s gradient table — see its comment).
      const vecX = xi + toFloat32(RAND_VECS_2D[idx] ?? 0) * JITTER;
      const vecY = yi + toFloat32(RAND_VECS_2D[idx | 1] ?? 0) * JITTER;

      const newDistance = (vecX - sx) * (vecX - sx) + (vecY - sz) * (vecY - sz);

      distance1 = fastMax(fastMin(distance1, newDistance), distance0);
      if (newDistance < distance0) {
        distance0 = newDistance;
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
    x: closestCenterX / frequency,
    y: closestCenterY / frequency,
    cx: closestCellX,
    cy: closestCellY,
    f1: distance0,
    f2: distance1,
    noise: Math.fround(closestHash * Math.fround(INV_2_31)),
  };
}

export class Cellular2D {
  private readonly seed: number;
  private frequency = 1;

  /** `new Cellular2D(long seed)`: folds via `HashCommon.long2int` (unsigned shift). */
  constructor(seed: bigint) {
    this.seed = longSeedToInt32Unsigned(seed);
  }

  /** `Cellular2D.spread(double scaleFactor)`. */
  spread(scaleFactor: number): this {
    this.frequency *= scaleFactor;
    return this;
  }

  /** `Cellular2D.cell(double x, double y)`. */
  cell(x: number, z: number): Cell {
    return cellAt(this.seed, this.frequency, x, z);
  }

  /** `Cellular2D.noise(double x, double y)`: `cell(x, y).noise()`. */
  noise(x: number, z: number): number {
    return this.cell(x, z).noise;
  }

  /** `Cellular2D.then(ToDoubleFunction<Cell> f)`. */
  then(f: (cell: Cell) => number): Noise2D {
    return (x, z) => f(this.cell(x, z));
  }
}
