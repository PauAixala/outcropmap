/**
 * `FastNoiseLite`'s domain warp, as TFC configures it (plan section 9).
 *
 * `Noise2D.warped(OpenSimplex2D warp)` sets three things on the warp noise and then displaces the
 * sample position through it:
 *
 * ```java
 * default Noise2D warped(OpenSimplex2D warp) {
 *     warp.fnl.SetDomainWarpType(FastNoiseLite.DomainWarpType.OpenSimplex2);
 *     warp.fnl.SetFractalType(FastNoiseLite.FractalType.DomainWarpIndependent);
 *     warp.fnl.SetDomainWarpAmp(warp.getAmplitude() * 2);
 *     final FastNoiseLite.Vector2 cursor = new FastNoiseLite.Vector2(0, 0);
 *     return (x, z) -> { cursor.x = x; cursor.y = z; warp.fnl.DomainWarp(cursor); return noise(cursor.x, cursor.y); };
 * }
 * ```
 *
 * Three of TFC's biome terrain functions depend on it — `canyons`, `ocean` and `oceanRidge` — and
 * ocean covers a large share of any map, so there is no version of surface height that skips this.
 *
 * **This is not the generic `warp2D` in `src/core/noise/domain-warp.ts`.** That one displaces by two
 * arbitrary noise fields; this is FastNoiseLite's simplex *gradient* warp, with its own skew, its
 * own hash-indexed gradient tables and a specific amplitude constant (`38.283687591552734375f`).
 * Substituting the generic one would produce plausible, wrong terrain.
 *
 * Java semantics preserved (CLAUDE.md section 2): the whole inner routine is `float` arithmetic
 * (`Math.fround` throughout) over `double` inputs, and `FastFloor` truncates toward negative
 * infinity, unlike a bare `| 0`.
 *
 * @unverified No golden fixture yet. See docs/PARITY.md.
 */
import {
  GRADIENTS_2D_TABLE,
  PRIME_X,
  PRIME_Y,
  RAND_VECS_2D,
  calculateFractalBounding,
  fastFloor,
  hash2D,
} from './fast-noise-lite';

/** `FastNoiseLite.Vector2`, mutated in place by the warp exactly as the Java does. */
export interface WarpCursor {
  x: number;
  y: number;
}

const SQRT3 = 1.7320508075688772935274463415059;
/** `F2` in `DomainWarpFractalIndependent`'s pre-skew. */
const F2 = 0.5 * (SQRT3 - 1);
/** `G2` inside the gradient warp. Computed in float, as the Java does. */
const G2 = Math.fround(Math.fround(3 - Math.fround(SQRT3)) / 6);
/** `DoSingleDomainWarp`'s OpenSimplex2 amplitude constant. */
const WARP_AMP_SCALE = Math.fround(38.283687591552734375);

/** Library defaults TFC never overrides. */
const LACUNARITY = 2;
const GAIN = 0.5;

const f = Math.fround;

/**
 * `SingleDomainWarpSimplexGradient(seed, warpAmp, frequency, x, y, coord, outGradOnly=false)`.
 * Adds the warp displacement into `coord`.
 */
function singleDomainWarpSimplexGradient(
  seed: number,
  warpAmp: number,
  frequency: number,
  xIn: number,
  yIn: number,
  coord: WarpCursor,
): void {
  const x = xIn * frequency;
  const y = yIn * frequency;

  let i = fastFloor(x);
  let j = fastFloor(y);
  const xi = f(x - i);
  const yi = f(y - j);

  const t = f(f(xi + yi) * G2);
  const x0 = f(xi - t);
  const y0 = f(yi - t);

  i = Math.imul(i, PRIME_X);
  j = Math.imul(j, PRIME_Y);

  let vx = 0;
  let vy = 0;

  /** The non-`outGradOnly` branch: a gradient dot product steering a random vector. */
  const contribute = (weight: number, hx: number, hy: number, px: number, py: number): void => {
    const hash = hash2D(seed, hx, hy);
    const index1 = hash & (127 << 1);
    const index2 = (hash >> 7) & (255 << 1);
    const xg = f(GRADIENTS_2D_TABLE[index1] ?? 0);
    const yg = f(GRADIENTS_2D_TABLE[index1 | 1] ?? 0);
    const value = f(f(px * xg) + f(py * yg));
    const xgo = f(RAND_VECS_2D[index2] ?? 0);
    const ygo = f(RAND_VECS_2D[index2 | 1] ?? 0);
    vx = f(vx + f(weight * f(value * xgo)));
    vy = f(vy + f(weight * f(value * ygo)));
  };

  const a = f(f(f(0.5 - f(x0 * x0)) - f(y0 * y0)));
  if (a > 0) {
    const aaaa = f(f(a * a) * f(a * a));
    contribute(aaaa, i, j, x0, y0);
  }

  // c = (2 * (1 - 2 * G2) * (1 / G2 - 2)) * t + ((-2 * (1 - 2 * G2) * (1 - 2 * G2)) + a)
  const oneMinusTwoG2 = f(1 - f(2 * G2));
  const cSlope = f(f(f(2 * oneMinusTwoG2) * f(f(1 / G2) - 2)));
  const cOffset = f(f(f(-2 * oneMinusTwoG2) * oneMinusTwoG2));
  const c = f(f(cSlope * t) + f(cOffset + a));
  if (c > 0) {
    const cornerOffset = f(f(2 * G2) - 1);
    const x2 = f(x0 + cornerOffset);
    const y2 = f(y0 + cornerOffset);
    const cccc = f(f(c * c) * f(c * c));
    contribute(cccc, (i + PRIME_X) | 0, (j + PRIME_Y) | 0, x2, y2);
  }

  if (y0 > x0) {
    const x1 = f(x0 + G2);
    const y1 = f(y0 + f(G2 - 1));
    const b = f(f(0.5 - f(x1 * x1)) - f(y1 * y1));
    if (b > 0) {
      const bbbb = f(f(b * b) * f(b * b));
      contribute(bbbb, i, (j + PRIME_Y) | 0, x1, y1);
    }
  } else {
    const x1 = f(x0 + f(G2 - 1));
    const y1 = f(y0 + G2);
    const b = f(f(0.5 - f(x1 * x1)) - f(y1 * y1));
    if (b > 0) {
      const bbbb = f(f(b * b) * f(b * b));
      contribute(bbbb, (i + PRIME_X) | 0, j, x1, y1);
    }
  }

  coord.x += f(vx * warpAmp);
  coord.y += f(vy * warpAmp);
}

/**
 * `DomainWarpFractalIndependent(Vector2)` with `DomainWarpType.OpenSimplex2` — the only combination
 * TFC uses. Pre-skews once, then applies one warp per octave with an advancing seed, decaying
 * amplitude and growing frequency.
 *
 * `domainWarpAmp` is `warp.getAmplitude() * 2` (set by `Noise2D.warped`), and `amp` starts at
 * `domainWarpAmp * fractalBounding` — the same bounding value the fractal noise uses.
 */
export function domainWarpIndependent(
  coord: WarpCursor,
  seed: number,
  domainWarpAmp: number,
  frequency: number,
  octaves: number,
): void {
  // Pre-skew, done once before the octave loop (not inside the gradient routine).
  const t = (coord.x + coord.y) * F2;
  const xs = coord.x + t;
  const ys = coord.y + t;

  let octaveSeed = seed | 0;
  let amp = f(f(domainWarpAmp) * calculateFractalBounding(octaves));
  let freq = f(frequency);

  for (let i = 0; i < octaves; i++) {
    singleDomainWarpSimplexGradient(octaveSeed, f(amp * WARP_AMP_SCALE), freq, xs, ys, coord);
    octaveSeed = (octaveSeed + 1) | 0;
    amp = f(amp * GAIN);
    freq = f(freq * LACUNARITY);
  }
}
