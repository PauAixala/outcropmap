import { describe, expect, it } from 'vitest';
import { biomeHeightNoise } from '@worldgen/tfc-1.20/biome/height-noise';
import { Biome } from '@worldgen/tfc-1.20/biome/ids';

describe('TFC 1.20 biome height-noise wiring', () => {
  it('assigns a height factory to every biome except the river placeholder', () => {
    for (let biome = Biome.OCEAN; biome <= Biome.PLATEAU_LAKE; biome++) {
      expect(biomeHeightNoise(biome, 0n) === null).toBe(biome === Biome.RIVER);
    }
  });

  it('uses the world seed directly and keeps related lake height maps aligned', () => {
    const point = [8192.5, 4096.25] as const;
    const mountain = biomeHeightNoise(Biome.MOUNTAINS, 123456789n);
    const mountainLake = biomeHeightNoise(Biome.MOUNTAIN_LAKE, 123456789n);
    const volcanic = biomeHeightNoise(Biome.VOLCANIC_MOUNTAINS, 123456789n);
    const volcanicLake = biomeHeightNoise(Biome.VOLCANIC_MOUNTAIN_LAKE, 123456789n);
    expect(mountain?.(...point)).toBe(mountainLake?.(...point));
    expect(volcanic?.(...point)).toBe(volcanicLake?.(...point));
  });
});
