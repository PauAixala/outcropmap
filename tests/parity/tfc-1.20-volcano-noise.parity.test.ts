/** VolcanoNoise outputs captured by compiling and running the actual TFC 1.20 Java sources. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VolcanoNoise } from '@worldgen/tfc-1.20/biome/volcano-noise';

interface VolcanoCase {
  readonly seed: string;
  readonly x: number;
  readonly z: number;
  readonly rarity: number;
  readonly baseHeight: number;
  readonly easing: number;
  readonly center: readonly [number, number, number] | null;
  readonly modifiedHeight: number;
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tfc-1.20/volcano-noise.json',
);
const fixture: {
  readonly source: string;
  readonly revision: string;
  readonly cases: VolcanoCase[];
} = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('TFC 1.20 VolcanoNoise parity (real JDK-compiled source)', () => {
  it('contains cases both inside and outside eligible volcano cells', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    expect(fixture.cases.some((entry) => entry.center !== null)).toBe(true);
    expect(fixture.cases.some((entry) => entry.center === null)).toBe(true);
  });

  for (const entry of fixture.cases) {
    it(`seed=${entry.seed} x=${entry.x} z=${entry.z} rarity=${entry.rarity}`, () => {
      const noise = new VolcanoNoise(BigInt(entry.seed));
      expect(noise.calculateEasing(Math.trunc(entry.x), Math.trunc(entry.z), entry.rarity)).toBe(
        entry.easing,
      );
      const center = noise.calculateCenter(
        Math.trunc(entry.x),
        70,
        Math.trunc(entry.z),
        entry.rarity,
      );
      expect(center === null ? null : [center.x, center.y, center.z]).toEqual(entry.center);
      expect(noise.modifyHeight(entry.x, entry.z, entry.baseHeight, entry.rarity, 18, 96)).toBe(
        entry.modifiedHeight,
      );
    });
  }
});
