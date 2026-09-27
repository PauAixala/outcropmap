/**
 * TFC 1.20 biome to height-noise wiring from `TFCBiomes` and `BiomeBuilder.volcanoes`.
 * Every factory receives `TFCChunkGenerator.noiseSamplerSeed`, which is the world seed set by
 * `TFCChunkGenerator.initRandomState`.
 */
import type { Noise2D } from '../noise/noise2d';
import { Biome } from './ids';
import {
  addVolcanoes,
  badlands,
  bryceCanyon,
  canyons,
  hills,
  lake,
  lowlands,
  mountains,
  ocean,
  oceanRidge,
  sharpHills,
  shore,
  tidalFlats,
} from './biome-noise';

export function biomeHeightNoise(biome: Biome, seed: bigint): Noise2D | null {
  switch (biome) {
    case Biome.OCEAN:
      return ocean(seed, -26, -12);
    case Biome.OCEAN_REEF:
      return ocean(seed, -16, -8);
    case Biome.DEEP_OCEAN:
      return ocean(seed, -30, -16);
    case Biome.DEEP_OCEAN_TRENCH:
      return oceanRidge(seed, -30, -16);
    case Biome.PLAINS:
      return hills(seed, 4, 10);
    case Biome.HILLS:
      return hills(seed, -5, 16);
    case Biome.LOWLANDS:
    case Biome.SALT_MARSH:
      return lowlands(seed);
    case Biome.LOW_CANYONS:
      return canyons(seed, -8, 21);
    case Biome.ROLLING_HILLS:
      return hills(seed, -5, 28);
    case Biome.HIGHLANDS:
      return sharpHills(seed);
    case Biome.BADLANDS:
      return badlands(seed);
    case Biome.INVERTED_BADLANDS:
      return bryceCanyon(seed);
    case Biome.PLATEAU:
    case Biome.PLATEAU_LAKE:
      return hills(seed, 20, 30);
    case Biome.CANYONS:
      return addVolcanoes(seed, canyons(seed, -2, 40), 6, 14, 30);
    case Biome.MOUNTAINS:
    case Biome.MOUNTAIN_LAKE:
      return mountains(seed, 10, 70);
    case Biome.OLD_MOUNTAINS:
      return mountains(seed, 16, 40);
    case Biome.OLD_MOUNTAIN_LAKE:
    case Biome.OCEANIC_MOUNTAINS:
    case Biome.OCEANIC_MOUNTAIN_LAKE:
      return mountains(seed, -16, 60);
    case Biome.VOLCANIC_MOUNTAINS:
    case Biome.VOLCANIC_MOUNTAIN_LAKE:
      return addVolcanoes(seed, mountains(seed, 10, 60), 4, 25, 50);
    case Biome.VOLCANIC_OCEANIC_MOUNTAINS:
    case Biome.VOLCANIC_OCEANIC_MOUNTAIN_LAKE:
      return addVolcanoes(seed, mountains(seed, -24, 50), 2, -12, 50);
    case Biome.SHORE:
      return shore(seed);
    case Biome.TIDAL_FLATS:
      return tidalFlats(seed);
    case Biome.LAKE:
      return lake(seed);
    case Biome.RIVER:
      // TFC's river biome has no height map; ChunkHeightFiller substitutes its surrounding biome.
      return null;
  }
}
