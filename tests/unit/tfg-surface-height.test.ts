import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import biomeHeights from '../../src/data/tfg/biome-heights.json';
import { createGenerator } from '../../src/worldgen/registry';
import { evaluateHeightExpression } from '../../src/worldgen/tfg/biome/height-expression';
import { createHeightRegistry } from '../../src/worldgen/tfg/biome/height-registry';
import { TFGSurfaceHeightSampler } from '../../src/worldgen/tfg/biome/surface-height';
import { B } from '../../src/worldgen/tfg/biome/ids';

type Extracted = { biomes: Record<string, { expression: string } | null> };
const table = (biomeHeights as unknown as Extracted).biomes;

describe('TFG height expressions', () => {
  it('evaluates every biome that declares a heightmap', () => {
    // The one exception is `river`, which TFG registers with a surface builder and no heightmap,
    // exactly as TFC does — its height comes from the river carver instead.
    const registry = createHeightRegistry(42n);
    const failures: string[] = [];
    let evaluated = 0;
    for (const [name, entry] of Object.entries(table)) {
      if (!entry) {
        expect(name, 'only `river` may lack a heightmap').toBe('river');
        continue;
      }
      try {
        const value = evaluateHeightExpression(entry.expression, 42n, registry)(100, 200);
        expect(Number.isFinite(value), `${name} produced ${value}`).toBe(true);
        evaluated++;
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
    expect(evaluated).toBe(108);
  });

  it('reports nothing as unsupported', () => {
    const sampler = new TFGSurfaceHeightSampler(42n, () => 4);
    expect(sampler.unsupported).toEqual([]);
  });
});

describe('TFG surface height', () => {
  const generator = createGenerator('tfg', { seed: 0n, dimension: 'overworld' });

  it('answers for every column, never null', () => {
    // It used to be null everywhere; the remaining risk is the opposite failure, a blend touching a
    // biome with no factory. The sampler returns null in that case rather than a partial blend, so
    // any null here is a real coverage gap.
    for (let z = 0; z < 1024; z += 64) {
      for (let x = 0; x < 1024; x += 64) {
        expect(generator.surfaceY(x, z), `null at ${x},${z}`).not.toBeNull();
      }
    }
  });

  it('produces heights in a plausible world range', () => {
    const heights: number[] = [];
    for (let z = 0; z < 1024; z += 32) {
      for (let x = 0; x < 1024; x += 32) {
        const height = generator.surfaceY(x, z);
        if (height !== null) heights.push(height);
      }
    }
    expect(heights.length).toBeGreaterThan(500);
    // Deep ocean floor to mountain top. Far outside this means a landform's scale is wrong.
    expect(Math.min(...heights)).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThan(220);
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    expect(mean).toBeGreaterThan(40);
    expect(mean).toBeLessThan(120);
  });

  it('is deterministic for a seed', () => {
    const other = createGenerator('tfg', { seed: 0n, dimension: 'overworld' });
    for (let i = 0; i < 40; i++) {
      const x = i * 37;
      const z = i * 53;
      expect(generator.surfaceY(x, z)).toBe(other.surfaceY(x, z));
    }
  });

  it('uses the river-free biome layer', () => {
    // `river` has no height factory. If the height path ever reads the river-carved layer again,
    // every column near a river goes null -- which is how this was caught the first time.
    // Imported rather than written as a number: I first hardcoded 23 here, and TFG's river is 31,
    // so the test passed a perfectly ordinary biome and proved nothing.
    const sampler = new TFGSurfaceHeightSampler(0n, () => B.RIVER);
    expect(sampler.sample(0, 0)).toBeNull();
  });
});
