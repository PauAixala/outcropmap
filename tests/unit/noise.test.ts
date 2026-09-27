import { describe, expect, it } from 'vitest';
import { JavaRandom, XoroshiroRandomSource } from '@core/random';
import {
  ImprovedNoise,
  OctaveNoise,
  OpenSimplex2Noise,
  SimplexNoise,
  cellular,
  metaballContains,
  metaballField,
  warp2D,
} from '@core/noise';

describe('ImprovedNoise', () => {
  it('is deterministic for a given seed', () => {
    const a = new ImprovedNoise(new JavaRandom(7n));
    const b = new ImprovedNoise(new JavaRandom(7n));
    expect(a.sample(1.5, 2.5, 3.5)).toBe(b.sample(1.5, 2.5, 3.5));
  });

  it('different seeds produce different permutation tables (near-certainly different output)', () => {
    const a = new ImprovedNoise(new JavaRandom(1n));
    const b = new ImprovedNoise(new JavaRandom(2n));
    expect(a.sample(1.5, 2.5, 3.5)).not.toBe(b.sample(1.5, 2.5, 3.5));
  });

  it('stays within the classic improved-noise output bound of roughly [-1, 1]', () => {
    const noise = new ImprovedNoise(new JavaRandom(99n));
    for (let x = -20; x <= 20; x += 1.3) {
      for (let z = -20; z <= 20; z += 1.7) {
        const v = noise.sample(x, 5, z);
        expect(v).toBeGreaterThanOrEqual(-1.01);
        expect(v).toBeLessThanOrEqual(1.01);
      }
    }
  });

  it('is continuous: a small step in input produces a small step in output', () => {
    const noise = new ImprovedNoise(new JavaRandom(3n));
    const a = noise.sample(10, 10, 10);
    const b = noise.sample(10.001, 10, 10);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });

  it('also accepts an XoroshiroRandomSource (any RandomSource works)', () => {
    expect(() => new ImprovedNoise(XoroshiroRandomSource.fromSeed(1n))).not.toThrow();
  });
});

describe('SimplexNoise', () => {
  it('is deterministic and bounded', () => {
    const noise = new SimplexNoise(new JavaRandom(11n));
    for (let x = -10; x <= 10; x += 0.9) {
      for (let y = -10; y <= 10; y += 1.1) {
        const v = noise.sample(x, y);
        expect(v).toBeGreaterThanOrEqual(-1.01);
        expect(v).toBeLessThanOrEqual(1.01);
      }
    }
    expect(noise.sample(1, 1)).toBe(noise.sample(1, 1));
  });
});

describe('OctaveNoise', () => {
  it('is deterministic and roughly bounded within [-1, 1]', () => {
    const noise = new OctaveNoise(new JavaRandom(5n), { octaves: 4 });
    for (let x = -10; x <= 10; x += 2.1) {
      const v = noise.sample(x, 0, 0);
      expect(v).toBeGreaterThanOrEqual(-1.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
    expect(noise.sample(3, 4, 5)).toBe(noise.sample(3, 4, 5));
  });

  it('rejects a non-positive octave count', () => {
    expect(() => new OctaveNoise(new JavaRandom(1n), { octaves: 0 })).toThrow();
  });
});

describe('OpenSimplex2Noise', () => {
  it('is deterministic and produces finite output', () => {
    const noise = new OpenSimplex2Noise(new JavaRandom(21n));
    for (let x = -10; x <= 10; x += 1.3) {
      for (let y = -10; y <= 10; y += 1.7) {
        const v = noise.sample(x, y);
        expect(Number.isFinite(v)).toBe(true);
      }
    }
    expect(noise.sample(2, 2)).toBe(noise.sample(2, 2));
  });
});

describe('cellular', () => {
  it('is deterministic given (seed, x, y)', () => {
    const a = cellular(1, 3.3, 4.4);
    const b = cellular(1, 3.3, 4.4);
    expect(a).toEqual(b);
  });

  it('distance is always non-negative and bounded within a couple of cells', () => {
    for (let x = -5; x <= 5; x += 0.7) {
      for (let y = -5; y <= 5; y += 0.9) {
        const r = cellular(42, x, y);
        expect(r.distance).toBeGreaterThanOrEqual(0);
        expect(r.distance).toBeLessThan(2);
      }
    }
  });

  it('different seeds usually produce different fields', () => {
    const a = cellular(1, 3.3, 4.4);
    const b = cellular(2, 3.3, 4.4);
    expect(a).not.toEqual(b);
  });
});

describe('metaball', () => {
  it('is 1 at a ball centre and 0 well outside its radius', () => {
    const balls = [{ x: 0, y: 0, z: 0, radius: 5 }];
    expect(metaballField(0, 0, 0, balls)).toBe(1);
    expect(metaballField(100, 100, 100, balls)).toBe(0);
  });

  it('sums overlapping balls', () => {
    const balls = [
      { x: 0, y: 0, z: 0, radius: 5 },
      { x: 1, y: 0, z: 0, radius: 5 },
    ];
    expect(metaballField(0, 0, 0, balls)).toBeGreaterThan(1);
  });

  it('metaballContains matches thresholding the field', () => {
    const balls = [{ x: 0, y: 0, z: 0, radius: 5 }];
    expect(metaballContains(0, 0, 0, balls, 0.5)).toBe(true);
    expect(metaballContains(100, 100, 100, balls, 0.5)).toBe(false);
  });
});

describe('warp2D', () => {
  it('domain-warping with a zero-strength warp is the identity', () => {
    const base = new SimplexNoise(new JavaRandom(1n));
    const warpX = new SimplexNoise(new JavaRandom(2n));
    const warpY = new SimplexNoise(new JavaRandom(3n));
    expect(warp2D(base, warpX, warpY, 5, 5, 0)).toBe(base.sample(5, 5));
  });

  it('a nonzero warp strength changes the sample', () => {
    const base = new SimplexNoise(new JavaRandom(1n));
    const warpX = new SimplexNoise(new JavaRandom(2n));
    const warpY = new SimplexNoise(new JavaRandom(3n));
    expect(warp2D(base, warpX, warpY, 5, 5, 2)).not.toBe(base.sample(5, 5));
  });
});
