import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { SurfaceHeightSampler } from '../../src/worldgen/tfc-1.20/biome/surface-height';
import { RegionGenerator } from '../../src/worldgen/tfc-1.20/region/generator';

/** The live generator, plus a second height sampler over the same region with rivers switched off. */
function samplers(seed: bigint) {
  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
  const region = (generator as unknown as { region: RegionGenerator }).region;
  const withoutRivers = new SurfaceHeightSampler(seed, (quartX, quartZ) =>
    region.biomeAtQuart(quartX, quartZ),
  );
  return { generator, withoutRivers };
}

describe('river carving in the height field', () => {
  const { generator, withoutRivers } = samplers(0n);

  it('never raises the ground, only lowers it', () => {
    // Every sampler is `min(riverHeight, heightIn)`, so carving is one-directional. If this ever
    // fails, a sampler's sign or its blend weight is wrong, and the terrain grows hills along
    // rivers instead of valleys.
    for (let z = 0; z < 1024; z += 16) {
      for (let x = 0; x < 1024; x += 16) {
        expect(generator.surfaceY(x, z)!).toBeLessThanOrEqual(withoutRivers.sample(x, z));
      }
    }
  });

  it('actually carves somewhere, rather than being wired up and inert', () => {
    let carved = 0;
    for (let z = 0; z < 2048; z += 8) {
      for (let x = 0; x < 2048; x += 8) {
        if (generator.surfaceY(x, z)! < withoutRivers.sample(x, z)) carved++;
      }
    }
    expect(carved).toBeGreaterThan(100);
  });

  it('puts river columns in a valley, close above sea level', () => {
    let riverSum = 0;
    let riverCount = 0;
    let landSum = 0;
    let landCount = 0;
    for (let z = 0; z < 2048; z += 8) {
      for (let x = 0; x < 2048; x += 8) {
        const biome = generator.biome(x, z);
        const height = generator.surfaceY(x, z)!;
        if (biome === 'tfc:river') {
          riverSum += height;
          riverCount++;
        } else if (biome !== null && !biome.includes('ocean') && !biome.includes('lake')) {
          landSum += height;
          landCount++;
        }
      }
    }
    expect(riverCount).toBeGreaterThan(0);
    const riverMean = riverSum / riverCount;
    const landMean = landSum / landCount;
    // A river runs below the land around it...
    expect(riverMean).toBeLessThan(landMean - 5);
    // ...and just above sea level (63), which is what makes it hold water rather than drain.
    expect(riverMean).toBeGreaterThan(60);
    expect(riverMean).toBeLessThan(75);
  });
});
