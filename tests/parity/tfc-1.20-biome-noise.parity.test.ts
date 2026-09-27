/** BiomeNoise outputs captured by compiling and running the actual TFC 1.20 Java sources. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
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
  sharpHillsMap,
  shore,
  tidalFlats,
} from '@worldgen/tfc-1.20/biome/biome-noise';
import type { Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';

interface BiomeNoiseCase {
  readonly name: string;
  readonly seed: string;
  readonly x: number;
  readonly z: number;
  readonly value: number;
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tfc-1.20/biome-noise.json',
);
const fixture: {
  readonly source: string;
  readonly revision: string;
  readonly cases: BiomeNoiseCase[];
} = JSON.parse(readFileSync(fixturePath, 'utf8'));

function noiseFor(name: string, seed: bigint): Noise2D {
  switch (name) {
    case 'badlands':
      return badlands(seed);
    case 'bryceCanyon':
      return bryceCanyon(seed);
    case 'canyonsLow':
      return canyons(seed, -8, 21);
    case 'canyons':
      return canyons(seed, -2, 40);
    case 'hillsPlains':
      return hills(seed, 4, 10);
    case 'hills':
      return hills(seed, -5, 16);
    case 'hillsRolling':
      return hills(seed, -5, 28);
    case 'hillsPlateau':
      return hills(seed, 20, 30);
    case 'sharpHills':
      return sharpHills(seed);
    case 'lake':
      return lake(seed);
    case 'lowlands':
      return lowlands(seed);
    case 'mountains':
      return mountains(seed, 10, 70);
    case 'oldMountains':
      return mountains(seed, 16, 40);
    case 'oceanicMountains':
      return mountains(seed, -16, 60);
    case 'volcanicMountainsBase':
      return mountains(seed, 10, 60);
    case 'volcanicOceanicMountainsBase':
      return mountains(seed, -24, 50);
    case 'ocean':
      return ocean(seed, -26, -12);
    case 'oceanReef':
      return ocean(seed, -16, -8);
    case 'deepOcean':
      return ocean(seed, -30, -16);
    case 'oceanRidge':
      return oceanRidge(seed, -30, -16);
    case 'shore':
      return shore(seed);
    case 'tidalFlats':
      return tidalFlats(seed);
    case 'volcanicCanyons':
      return addVolcanoes(seed, canyons(seed, -2, 40), 6, 14, 30);
    case 'volcanicMountains':
      return addVolcanoes(seed, mountains(seed, 10, 60), 4, 25, 50);
    case 'volcanicOceanicMountains':
      return addVolcanoes(seed, mountains(seed, -24, 50), 2, -12, 50);
    default:
      throw new Error(`Unknown fixture function: ${name}`);
  }
}

describe('TFC 1.20 BiomeNoise parity (real JDK-compiled source)', () => {
  it('covers every shipped terrain-noise family', () => {
    expect(new Set(fixture.cases.map((entry) => entry.name))).toEqual(
      new Set([
        'badlands',
        'bryceCanyon',
        'canyonsLow',
        'canyons',
        'hillsPlains',
        'hills',
        'hillsRolling',
        'hillsPlateau',
        'sharpHills',
        'lake',
        'lowlands',
        'mountains',
        'oldMountains',
        'oceanicMountains',
        'volcanicMountainsBase',
        'volcanicOceanicMountainsBase',
        'ocean',
        'oceanReef',
        'deepOcean',
        'oceanRidge',
        'shore',
        'tidalFlats',
        'volcanicCanyons',
        'volcanicMountains',
        'volcanicOceanicMountains',
        'sharpHillsMap',
      ]),
    );
  });

  const cache = new Map<string, Noise2D>();
  for (const entry of fixture.cases) {
    it(`${entry.name} seed=${entry.seed} x=${entry.x} z=${entry.z}`, () => {
      const actual =
        entry.name === 'sharpHillsMap'
          ? sharpHillsMap(entry.x)
          : (() => {
              const key = `${entry.name}:${entry.seed}`;
              let noise = cache.get(key);
              if (noise === undefined) {
                noise = noiseFor(entry.name, BigInt(entry.seed));
                cache.set(key, noise);
              }
              return noise(entry.x, entry.z);
            })();
      expect(actual).toBe(entry.value);
    });
  }
});
