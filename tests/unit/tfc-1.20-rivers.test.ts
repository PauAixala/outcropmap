import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { Biome, hasRivers } from '../../src/worldgen/tfc-1.20/biome/ids';

describe('hasRivers', () => {
  it('excludes exactly the biomes TFC builds with noRivers()', () => {
    // Oceans, both shores and every lake variant. A river is never carved through those.
    for (const biome of [
      Biome.OCEAN,
      Biome.OCEAN_REEF,
      Biome.DEEP_OCEAN,
      Biome.DEEP_OCEAN_TRENCH,
      Biome.SHORE,
      Biome.TIDAL_FLATS,
      Biome.LAKE,
      Biome.MOUNTAIN_LAKE,
      Biome.VOLCANIC_MOUNTAIN_LAKE,
      Biome.OLD_MOUNTAIN_LAKE,
      Biome.OCEANIC_MOUNTAIN_LAKE,
      Biome.VOLCANIC_OCEANIC_MOUNTAIN_LAKE,
      Biome.PLATEAU_LAKE,
    ]) {
      expect(hasRivers(biome), `biome ${biome}`).toBe(false);
    }
    for (const biome of [Biome.PLAINS, Biome.HILLS, Biome.HIGHLANDS, Biome.MOUNTAINS, Biome.CANYONS]) {
      expect(hasRivers(biome), `biome ${biome}`).toBe(true);
    }
  });
});

describe('rivers on the biome layer', () => {
  it('carves rivers through the land, and only through the land', () => {
    const generator = createGenerator('tfc-1.20', { seed: 0n, dimension: 'overworld' });
    let river = 0;
    let land = 0;
    for (let z = 0; z < 2048; z += 16) {
      for (let x = 0; x < 2048; x += 16) {
        const biome = generator.biome(x, z);
        if (biome === 'tfc:river') river++;
        else if (biome !== null && !biome.includes('ocean') && !biome.includes('lake')) land++;
      }
    }
    // The whole point of section 7: the user could not see rivers at all before this.
    expect(river).toBeGreaterThan(0);
    // A few percent of land. Far outside that in either direction means the intersect threshold or
    // the partition lookup is wrong, not that the seed is unusual.
    const share = river / (river + land);
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.15);
  });

  it('is stable for a given seed and position', () => {
    const a = createGenerator('tfc-1.20', { seed: 7n, dimension: 'overworld' });
    const b = createGenerator('tfc-1.20', { seed: 7n, dimension: 'overworld' });
    for (let i = 0; i < 200; i++) {
      const x = i * 37;
      const z = i * 53;
      expect(a.biome(x, z)).toBe(b.biome(x, z));
    }
  });

  it('leaves the height field on the river-free biome layer', () => {
    // `tfc:river` has no height map of its own -- TFCChunkGenerator asks for the no-river biome, so
    // a river must not blank out the surface height under it.
    const generator = createGenerator('tfc-1.20', { seed: 0n, dimension: 'overworld' });
    let checked = 0;
    for (let z = 0; z < 2048 && checked < 5; z += 16) {
      for (let x = 0; x < 2048 && checked < 5; x += 16) {
        if (generator.biome(x, z) !== 'tfc:river') continue;
        expect(generator.surfaceY(x, z)).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBe(5);
  });
});
