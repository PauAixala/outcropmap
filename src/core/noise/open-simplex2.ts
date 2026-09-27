/**
 * OpenSimplex2-style 2D noise: the same skewed-simplex-grid lattice as {@link SimplexNoise}, but
 * with OpenSimplex2's characteristic falloff kernel (quartic, radius^2 = 2/3 instead of 1/2) and a
 * larger, evenly-spaced gradient set, which together avoid the directional grid artifacts classic
 * Simplex noise shows along its lattice axes.
 *
 * Honesty note (read before trusting this against anything): this is **not** a port of Kurt
 * Spencer's public-domain OpenSimplex2 reference implementation. That reference hard-codes a
 * specific gradient table and 64-bit lattice-point hashing scheme; reproducing those bit-for-bit
 * from memory, without the reference to check against, risks exactly the "plausible but silently
 * wrong" failure AGENTS.md warns about. Instead this generates its own evenly-spaced unit gradients
 * at construction time and reuses this project's own permutation-table hashing (the same
 * `RandomSource`-seeded shuffle as `ImprovedNoise`/`SimplexNoise`). It has the right *shape*
 * (skewed simplex lattice, quartic radius-2/3 kernel — OpenSimplex2's defining characteristics) but
 * will not numerically match the reference implementation or any game that embeds it.
 *
 * @unverified No parity fixture — not proven to match any reference implementation. Whether TFC
 * even uses OpenSimplex2, and which variant, is unconfirmed (docs/WORLDGEN-NOTES.md). Treat this as
 * a placeholder with the right qualitative behaviour until that is settled.
 */

import type { RandomSource } from '@core/random';
import type { Noise2D } from './types';

const SQRT_3 = Math.sqrt(3);
const F2 = 0.5 * (SQRT_3 - 1);
const G2 = (3 - SQRT_3) / 6;
const KERNEL_RADIUS_SQ = 2 / 3;
const GRADIENT_COUNT = 24;

function buildGradients(count: number): readonly (readonly [number, number])[] {
  const gradients: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const angle = (2 * Math.PI * i) / count;
    gradients.push([Math.cos(angle), Math.sin(angle)]);
  }
  return gradients;
}

const GRADIENTS = buildGradients(GRADIENT_COUNT);

export class OpenSimplex2Noise implements Noise2D {
  private readonly perm: Uint8Array;

  constructor(random: RandomSource) {
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

  private gradientAt(cellX: number, cellY: number): readonly [number, number] {
    const h = this.perm[(cellX + this.perm[cellY & 255]!) & 255]!;
    return GRADIENTS[h % GRADIENT_COUNT]!;
  }

  private contribution(cellX: number, cellY: number, dx: number, dy: number): number {
    const distSq = dx * dx + dy * dy;
    if (distSq >= KERNEL_RADIUS_SQ) {
      return 0;
    }
    const falloff = KERNEL_RADIUS_SQ - distSq;
    const [gx, gy] = this.gradientAt(cellX, cellY);
    return falloff * falloff * falloff * falloff * (gx * dx + gy * dy);
  }

  sample(x: number, y: number): number {
    const skew = (x + y) * F2;
    const i = Math.floor(x + skew);
    const j = Math.floor(y + skew);
    const unskew = (i + j) * G2;
    const x0 = x - (i - unskew);
    const y0 = y - (j - unskew);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    return (
      this.contribution(i, j, x0, y0) +
      this.contribution(i + i1, j + j1, x1, y1) +
      this.contribution(i + 1, j + 1, x2, y2)
    );
  }
}
