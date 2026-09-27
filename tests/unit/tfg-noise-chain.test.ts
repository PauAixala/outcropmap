import { describe, expect, it } from 'vitest';
import { chain, simplex } from '../../src/worldgen/tfg/noise/noise-chain';

describe('NoiseChain.scaled', () => {
  // The whole reason this wrapper exists. Java overloads `scaled`, and the four-argument form puts
  // the SOURCE range first, the opposite of this project's own helper. Getting it backwards
  // produces terrain that still looks like terrain, at the wrong altitudes.
  const half = chain(() => 0.5);

  it('maps [-1, 1] to the given range with two arguments', () => {
    // 0.5 sits three quarters of the way up [-1, 1], so three quarters of the way up [0, 100].
    expect(half.scaled(0, 100).noiseAt(0, 0)).toBeCloseTo(75, 9);
  });

  it('takes the source range first with four arguments, as Java does', () => {
    // Source [0, 1] -> target [-8, 8]: 0.5 is the midpoint of the source, so the midpoint of the
    // target. Read in this project's own argument order it would instead give 0.5 -> about -7.
    expect(half.scaled(0, 1, -8, 8).noiseAt(0, 0)).toBeCloseTo(0, 9);
  });

  it('is not symmetric between the two forms', () => {
    // A guard against "fixing" the four-argument order to match the local helper: the two calls
    // below must disagree, and if someone swaps the ordering they stop disagreeing.
    expect(half.scaled(0, 1, -8, 8).noiseAt(0, 0)).not.toBeCloseTo(
      half.scaled(-8, 8, 0, 1).noiseAt(0, 0),
      6,
    );
  });
});

describe('simplex', () => {
  it('is deterministic for a seed', () => {
    const a = simplex(7n, { octaves: 2, spread: 0.1 });
    const b = simplex(7n, { octaves: 2, spread: 0.1 });
    for (let i = 0; i < 50; i++) expect(a.noiseAt(i, -i)).toBe(b.noiseAt(i, -i));
  });
});

describe('the two octaves methods are not the same function', () => {
  // Java overloads by static type: `new OpenSimplex2D(seed).octaves(4)` hits the generator's own
  // version (FastNoiseLite FBm plus a frequency change), while `...ridged().octaves(3)` hits the
  // Noise2D interface default (a manual FBm sum over the wrapped field). TFG uses both, sometimes
  // in the same chain. Confusing them gives terrain at a wrong but plausible scale.
  it('produces different fields for the same seed and count', () => {
    const generatorVersion = simplex(99n, { octaves: 3, spread: 0.02 });
    const wrapperVersion = simplex(99n, { spread: 0.02 }).octaves(3);
    let differences = 0;
    for (let i = 0; i < 200; i++) {
      if (Math.abs(generatorVersion.noiseAt(i, i) - wrapperVersion.noiseAt(i, i)) > 1e-9) {
        differences++;
      }
    }
    expect(differences).toBeGreaterThan(150);
  });
});
