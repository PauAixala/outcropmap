/**
 * Port of `net.dries007.tfc.world.noise.Metaballs3D` (TFC 1.20.x) — the blob shape a cluster vein
 * fills. A handful of weighted balls; a position is inside when the summed field exceeds 1.
 *
 * ```java
 * public static Metaballs3D simple(RandomSource random, int size) {
 *     return new Metaballs3D(random, 5, 7, 0.1f * size, 0.3f * size, 0.5f * size);
 * }
 *
 * public Metaballs3D(RandomSource random, int minBalls, int maxBalls, double minSize, double maxSize, double radius) {
 *     final int ballCount = Helpers.uniform(random, minBalls, maxBalls);
 *     final int negativeBallCount = minSize < 0 ? (int) (ballCount * (-minSize / (maxSize - minSize))) : 0;
 *     balls = new Ball[ballCount];
 *     for (int i = 0; i < balls.length; i++) {
 *         balls[i] = new Ball(
 *             Helpers.triangle(random, radius), Helpers.triangle(random, radius), Helpers.triangle(random, radius),
 *             i < negativeBallCount ? Helpers.uniform(random, minSize, 0) : Helpers.uniform(random, 0, maxSize));
 *     }
 * }
 *
 * public boolean inside(double x, double y, double z) {
 *     double f = 0;
 *     for (Ball ball : balls) {
 *         f += ball.weight * Math.abs(ball.weight) / ((x - ball.x) * (x - ball.x) + (y - ball.y) * (y - ball.y) + (z - ball.z) * (z - ball.z));
 *         if (f > 1) return true;
 *     }
 *     return false;
 * }
 * ```
 *
 * Java semantics preserved (CLAUDE.md section 2):
 *
 * - **`0.1f * size` is float arithmetic**, widened to `double` only when it reaches the
 *   constructor. `0.3f * 37` is `11.100000381469727` as a double, not `11.1` — hence `Math.fround`
 *   on each of the three derived sizes. Getting this wrong shifts every ball weight slightly and
 *   silently changes the vein's shape.
 * - `Helpers.uniform(random, int, int)` is `min + random.nextInt(max - min)`, so the ball count is
 *   `5 + nextInt(2)` — five or six, never seven.
 * - `Helpers.triangle(random, double)` is `(nextDouble() - nextDouble()) * delta` — **two** draws
 *   per axis, in that order.
 * - `Helpers.uniform(random, double, double)` is `nextDouble() * (max - min) + min`.
 * - `minSize` is `0.1f * size`, always positive here, so `negativeBallCount` is 0. The negative
 *   branch is kept in the comment above but is unreachable from `simple()`, so it is not ported.
 *
 * **Verified.** `tests/parity/tfc-1.20-metaballs.parity.test.ts` checks this against golden values
 * captured from the verbatim Java by `tools/parity/capture-tfc-metaballs.mjs`: ball tables,
 * membership, sampled magnitudes and the exact integer counts the UI derives from them, over 20
 * seed/size cases. The float-widening handling above is confirmed correct, not merely reasoned.
 */
import type { RandomSource } from '@core/random/random-source';

interface Ball {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly weight: number;
}

export interface Metaballs3D {
  inside(x: number, y: number, z: number): boolean;
  readonly balls: readonly Ball[];
}

/**
 * Where the blob's mass actually sits, relative to the vein's origin.
 *
 * The origin is the `BlockPos` the Java feature rolls, and the balls are scattered around it by
 * `Helpers.triangle(random, 0.5f * size)` — so the ore is not centred on the origin. Measured over
 * 72 TerraFirmaGreg cluster instances the body's centre of mass is a **mean 5.2 blocks (p90 8.3)**
 * away from it horizontally. Pau dug at three markers and found nothing at two; this is one of the
 * reasons why, and the marker is what a player walks to.
 *
 * An isolated ball of weight `w` is inside out to `r = w` (its field is `w²/r²`), so its volume
 * goes as `w³` and that is the weight here. Against the true centroid of the sampled body this is
 * off by a mean 1.2 blocks — where the origin is off by 5.2 — and it costs six multiplications
 * instead of a quarter-million `inside` tests per vein.
 *
 * ponytail: analytic estimate, not the sampled centroid. Sampling on a step-4 grid gets the error
 * to 0.3 blocks for ~0.1 ms per vein; do that if a block of marker accuracy ever matters more than
 * 40 ms per region.
 */
export function centreOfMass3D(shape: Metaballs3D): { x: number; y: number; z: number } {
  let total = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const ball of shape.balls) {
    const volume = ball.weight * ball.weight * ball.weight;
    total += volume;
    x += volume * ball.x;
    y += volume * ball.y;
    z += volume * ball.z;
  }
  return total === 0 ? { x: 0, y: 0, z: 0 } : { x: x / total, y: y / total, z: z / total };
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
 * `Metaballs3D.simple(random, size)`. Consumes exactly `1 + ballCount * 7` draws from `random`
 * (one `nextInt` for the count, then three `triangle` pairs and one `uniform` per ball), which is
 * what keeps a later vein's RNG stream aligned with the game's.
 */
export function simpleMetaballs3D(random: RandomSource, size: number): Metaballs3D {
  // Float arithmetic, then widened -- see the header.
  const maxSize = Math.fround(Math.fround(0.3) * size);
  const radius = Math.fround(Math.fround(0.5) * size);

  const ballCount = 5 + random.nextInt(2); // Helpers.uniform(random, 5, 7)
  const balls: Ball[] = [];
  for (let i = 0; i < ballCount; i++) {
    const x = triangle(random, radius);
    const y = triangle(random, radius);
    const z = triangle(random, radius);
    const weight = uniform(random, 0, maxSize);
    balls.push({ x, y, z, weight });
  }

  return {
    balls,
    inside(x: number, y: number, z: number): boolean {
      let f = 0;
      for (const ball of balls) {
        const dx = x - ball.x;
        const dy = y - ball.y;
        const dz = z - ball.z;
        f += (ball.weight * Math.abs(ball.weight)) / (dx * dx + dy * dy + dz * dz);
        if (f > 1) return true;
      }
      return false;
    },
  };
}
