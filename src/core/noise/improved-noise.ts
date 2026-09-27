/**
 * Ken Perlin's "improved noise" (SIGGRAPH 2002), as vanilla Minecraft ports it:
 * `net.minecraft.world.level.levelgen.synth.ImprovedNoise`. Vanilla's version differs from Perlin's
 * original reference in exactly one way that matters here — the 256-entry permutation table is
 * shuffled from a `RandomSource` at construction time (so it is reseedable per world seed) instead
 * of being Perlin's fixed reference table, and the offset origin (`xo`/`yo`/`zo`) is likewise drawn
 * from the same `RandomSource`. The gradient/fade/lerp math itself is the well-known public-domain
 * improved-noise algorithm, unchanged.
 *
 * `sampleWithYClamp` additionally ports vanilla's y-clamping trick (used by terrain density noise):
 * the lattice's vertical offset is clamped/quantized to `yScale` before computing gradients, while
 * the interpolation *weight* along y still uses the true, unclamped fractional y — this squashes
 * vertical banding without losing horizontal continuity. Passing `yScale = 0` (the default `sample`)
 * disables the clamp and is plain 3D improved noise.
 *
 * Verified against an independent Java reimplementation of the same public algorithm, permutation
 * table included, run on a real JVM: tests/fixtures/core/improved-noise.json. That confirms the
 * permutation shuffle (which depends on `JavaRandom`/`XoroshiroRandomSource`, already verified
 * separately) and the double-precision gradient math port correctly — it does not by itself confirm
 * this is what a specific Minecraft build ships (see the provenance note in xoroshiro.ts).
 */

import type { RandomSource } from '@core/random';
import type { Noise3D } from './types';

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

export class ImprovedNoise implements Noise3D {
  readonly xo: number;
  readonly yo: number;
  readonly zo: number;
  /** 256-entry permutation of [0, 255]. Every lookup masks its index with `& 255`, so this table
   *  never needs the doubled 512-entry form some reference implementations use for the same result. */
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

  /** `ImprovedNoise.noise(double, double, double)`. */
  sample(x: number, y: number, z: number): number {
    return this.sampleWithYClamp(x, y, z, 0, 0);
  }

  /** `ImprovedNoise.noise(double, double, double, double, double)` — see the class doc comment. */
  sampleWithYClamp(x: number, y: number, z: number, yScale: number, yMax: number): number {
    const xp = x + this.xo;
    const yp = y + this.yo;
    const zp = z + this.zo;
    const xi = Math.floor(xp);
    const yi = Math.floor(yp);
    const zi = Math.floor(zp);
    const xd = xp - xi;
    const yd = yp - yi;
    const zd = zp - zi;
    let clampedYd = yd;
    if (yScale !== 0) {
      const clampedYMax = yMax >= 0 && yMax < yd ? yMax : yd;
      clampedYd = Math.floor(clampedYMax / yScale) * yScale;
    }
    return this.sampleAndLerp(xi, yi, zi, xd, clampedYd, zd, yd);
  }

  private sampleAndLerp(
    gridX: number,
    gridY: number,
    gridZ: number,
    deltaX: number,
    deltaY: number,
    deltaZ: number,
    fadeYSource: number,
  ): number {
    const i = this.p(gridX);
    const j = this.p(gridX + 1);
    const k = this.p(i + gridY);
    const l = this.p(i + gridY + 1);
    const i1 = this.p(j + gridY);
    const j1 = this.p(j + gridY + 1);

    const d0 = grad(this.p(k + gridZ), deltaX, deltaY, deltaZ);
    const d1 = grad(this.p(i1 + gridZ), deltaX - 1, deltaY, deltaZ);
    const d2 = grad(this.p(l + gridZ), deltaX, deltaY - 1, deltaZ);
    const d3 = grad(this.p(j1 + gridZ), deltaX - 1, deltaY - 1, deltaZ);
    const d4 = grad(this.p(k + gridZ + 1), deltaX, deltaY, deltaZ - 1);
    const d5 = grad(this.p(i1 + gridZ + 1), deltaX - 1, deltaY, deltaZ - 1);
    const d6 = grad(this.p(l + gridZ + 1), deltaX, deltaY - 1, deltaZ - 1);
    const d7 = grad(this.p(j1 + gridZ + 1), deltaX - 1, deltaY - 1, deltaZ - 1);

    const u = fade(deltaX);
    const v = fade(fadeYSource);
    const w = fade(deltaZ);

    return lerp(
      w,
      lerp(v, lerp(u, d0, d1), lerp(u, d2, d3)),
      lerp(v, lerp(u, d4, d5), lerp(u, d6, d7)),
    );
  }
}
