/**
 * 2D simplex noise, as vanilla ports it: `net.minecraft.world.level.levelgen.synth.SimplexNoise`.
 * Same permutation-shuffle construction as {@link ImprovedNoise} (a `RandomSource`-seeded
 * Fisher-Yates shuffle of [0, 255]), applied to the classic Gustavson/Perlin 2D simplex algorithm
 * (skewed-grid corner selection, 12-direction gradient set, radial falloff kernel) — this is the
 * well-known public-domain simplex reference, unchanged.
 *
 * Verified against an independent Java reimplementation of the same public algorithm, run on a real
 * JVM: tests/fixtures/core/simplex-noise.json. Same provenance caveat as `improved-noise.ts` and
 * `xoroshiro.ts` — this confirms the JS port of the algorithm and its `RandomSource`-seeded
 * permutation table, not agreement with a specific Minecraft build's compiled class.
 */

import type { RandomSource } from '@core/random';
import type { Noise2D } from './types';

const SQRT_3 = Math.sqrt(3);
const F2 = 0.5 * (SQRT_3 - 1);
const G2 = (3 - SQRT_3) / 6;

/** The classic 12-direction (16-entry, 4 duplicated) simplex gradient set; only x/y are used here. */
const GRADIENT: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
  [1, 1, 0],
  [0, -1, 1],
  [-1, 1, 0],
  [0, -1, -1],
];

function dot2(g: readonly [number, number, number], x: number, y: number): number {
  return g[0] * x + g[1] * y;
}

export class SimplexNoise implements Noise2D {
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;
  private readonly perm: Uint8Array;

  constructor(random: RandomSource) {
    this.xo = random.nextDouble() * 256;
    this.yo = random.nextDouble() * 256;
    this.zo = random.nextDouble() * 256;
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    for (let i = 0; i < 256; i++) {
      const j = random.nextInt(256 - i);
      const tmp = p[i]!;
      p[i] = p[i + j]!;
      p[i + j] = tmp;
    }
    this.perm = p;
  }

  private p(i: number): number {
    return this.perm[i & 255]!;
  }

  /** `SimplexNoise.getValue(double, double)`. */
  sample(x: number, y: number): number {
    const skew = (x + y) * F2;
    const i = Math.floor(x + skew);
    const j = Math.floor(y + skew);
    const unskew = (i + j) * G2;
    const x0 = x - (i - unskew);
    const y0 = y - (j - unskew);

    let i1: number;
    let j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.p(ii + this.p(jj)) % 12;
    const gi1 = this.p(ii + i1 + this.p(jj + j1)) % 12;
    const gi2 = this.p(ii + 1 + this.p(jj + 1)) % 12;

    let n0 = 0;
    const t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const t0sq = t0 * t0;
      n0 = t0sq * t0sq * dot2(GRADIENT[gi0]!, x0, y0);
    }

    let n1 = 0;
    const t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const t1sq = t1 * t1;
      n1 = t1sq * t1sq * dot2(GRADIENT[gi1]!, x1, y1);
    }

    let n2 = 0;
    const t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const t2sq = t2 * t2;
      n2 = t2sq * t2sq * dot2(GRADIENT[gi2]!, x2, y2);
    }

    return 70 * (n0 + n1 + n2);
  }
}
