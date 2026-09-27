/**
 * Port of `net.dries007.tfc.world.noise.Metaballs2D` (TFC 1.20.x) — the footprint of a disc vein,
 * including kaolin.
 *
 * ```java
 * public static Metaballs2D simple(RandomSource random, int size) {
 *     return new Metaballs2D(random, 3, 8, 0.1f * size, 0.3f * size, 0.5f * size);
 * }
 *
 * public Metaballs2D(RandomSource random, int minBalls, int maxBalls, double minSize, double maxSize, double radius) {
 *     final int ballCount = Helpers.uniform(random, minBalls, maxBalls);
 *     balls = new Ball[ballCount];
 *     for (int i = 0; i < balls.length; i++) {
 *         balls[i] = new Ball(Helpers.triangle(random, radius), Helpers.triangle(random, radius),
 *                             Helpers.uniform(random, minSize, maxSize));
 *     }
 * }
 *
 * public double sample(double x, double z) {
 *     double f = 0;
 *     for (Ball ball : balls) f += ball.weight * Math.abs(ball.weight) / ((x - ball.x) * (x - ball.x) + (z - ball.z) * (z - ball.z));
 *     return f;
 * }
 * ```
 *
 * **Three differences from `Metaballs3D` that are easy to miss**, and each of them changes the
 * shape rather than erroring:
 *
 * 1. The ball count is `Helpers.uniform(random, 3, 8)` — `3 + nextInt(5)`, so three to seven, a
 *    different count *and* a different number of draws than the 3D version's `5 + nextInt(2)`.
 * 2. The weight is `uniform(random, minSize, maxSize)` — from `0.1f * size`, **not from zero** as
 *    in the 3D version. No ball is ever near-weightless here.
 * 3. `sample` has no `f > 1` early exit, so it returns the full field value. Callers need the
 *    magnitude, not just "inside": both disc chance functions scale the ore density by
 *    `clampedMap(sample, 2, 1, 1, 0.6)`.
 *
 * As in the 3D port, `0.1f * size` and friends are **float** arithmetic widened to `double`, hence
 * `Math.fround`.
 *
 * **Verified.** `tests/parity/tfc-1.20-metaballs.parity.test.ts` checks this against golden values
 * captured from the verbatim Java by `tools/parity/capture-tfc-metaballs.mjs`: ball tables,
 * membership, sampled magnitudes and the exact integer counts the UI derives from them, over 20
 * seed/size cases. The float-widening handling above is confirmed correct, not merely reasoned.
 */
import type { RandomSource } from '@core/random/random-source';

interface Ball {
  readonly x: number;
  readonly z: number;
  readonly weight: number;
}

export interface Metaballs2D {
  /** The raw field value. `> 1` is inside; both disc chance functions also scale by it. */
  sample(x: number, z: number): number;
  inside(x: number, z: number): boolean;
  readonly balls: readonly Ball[];
}

/** `Helpers.triangle(RandomSource, double)`: two draws, in this order. */
function triangle(random: RandomSource, delta: number): number {
  return (random.nextDouble() - random.nextDouble()) * delta;
}

/** `Helpers.uniform(RandomSource, double, double)`. */
function uniform(random: RandomSource, min: number, max: number): number {
  return random.nextDouble() * (max - min) + min;
}

/**
 * `Metaballs2D.simple(random, size)`. Consumes `1 + ballCount * 5` draws: one `nextInt` for the
 * count, then two `triangle` pairs and one `uniform` per ball.
 */
/**
 * Where a disc's footprint actually sits, relative to the vein's origin — the 2D twin of
 * `centreOfMass3D`, and there for the same reason: the marker should point at the ore, not at the
 * `BlockPos` the feature rolled. A ball of weight `w` is inside out to `r = w`, so in two
 * dimensions its area goes as `w²`.
 */
export function centreOfMass2D(shape: Metaballs2D): { x: number; z: number } {
  let total = 0;
  let x = 0;
  let z = 0;
  for (const ball of shape.balls) {
    const area = ball.weight * ball.weight;
    total += area;
    x += area * ball.x;
    z += area * ball.z;
  }
  return total === 0 ? { x: 0, z: 0 } : { x: x / total, z: z / total };
}

export function simpleMetaballs2D(random: RandomSource, size: number): Metaballs2D {
  const minSize = Math.fround(Math.fround(0.1) * size);
  const maxSize = Math.fround(Math.fround(0.3) * size);
  const radius = Math.fround(Math.fround(0.5) * size);

  const ballCount = 3 + random.nextInt(5); // Helpers.uniform(random, 3, 8)
  const balls: Ball[] = [];
  for (let i = 0; i < ballCount; i++) {
    const x = triangle(random, radius);
    const z = triangle(random, radius);
    const weight = uniform(random, minSize, maxSize);
    balls.push({ x, z, weight });
  }

  return {
    balls,
    sample(x: number, z: number): number {
      let f = 0;
      for (const ball of balls) {
        const dx = x - ball.x;
        const dz = z - ball.z;
        f += (ball.weight * Math.abs(ball.weight)) / (dx * dx + dz * dz);
      }
      return f;
    },
    inside(x: number, z: number): boolean {
      return this.sample(x, z) > 1;
    },
  };
}

/** `Mth.clampedMap` — used by both disc chance functions to taper the density. */
export function clampedMap(
  value: number,
  fromMin: number,
  fromMax: number,
  toMin: number,
  toMax: number,
): number {
  if (fromMax === fromMin) return toMin;
  const t = (value - fromMin) / (fromMax - fromMin);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return toMin + clamped * (toMax - toMin);
}
