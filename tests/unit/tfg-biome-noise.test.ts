import { describe, expect, it } from 'vitest';
import biomeHeights from '../../src/data/tfg/biome-heights.json';
import * as tfgNoise from '../../src/worldgen/tfg/noise/biome-noise';
import { hotspotFields } from '../../src/worldgen/tfg/noise/hotspots';

type Extracted = {
  _meta: { functions: Record<string, string[]> };
  biomes: Record<string, { expression: string; calls: string[] } | null>;
};

const data = biomeHeights as unknown as Extracted;

/** The hotspot chain lives in its own module, ported before this one. */
const IN_HOTSPOTS = new Set([
  'activeHotSpots',
  'dormantHotSpots',
  'extinctHotSpots',
  'ancientHotSpots',
  'hotSpotIntensity',
]);

describe('TFG biome noise coverage', () => {
  it('implements every TFGBiomeNoise function the biome table actually uses', () => {
    // The list is not written here -- it is whatever `tools/extract-tfg-biome-heights.mjs` found in
    // TFGBiomes.java. If TFG adds a landform and the data is re-extracted, this fails until it is
    // ported, rather than the biome silently falling back to something wrong.
    const required = data._meta.functions.TFGBiomeNoise ?? [];
    expect(required.length).toBeGreaterThan(40);
    const missing = required.filter(
      (name) => !IN_HOTSPOTS.has(name) && !(name in tfgNoise),
    );
    expect(missing, `not ported: ${missing.join(', ')}`).toEqual([]);
  });

  it('implements every TFGNoiseHelpers function it uses', async () => {
    const helpers = await import('../../src/worldgen/tfg/noise/noise-helpers');
    const required = data._meta.functions.TFGNoiseHelpers ?? [];
    // `max`/`min` are exported as maxOf/minOf, since `min` collides with the chain method.
    const alias: Record<string, string> = { max: 'maxOf', min: 'minOf' };
    const missing = required.filter((name) => !((alias[name] ?? name) in helpers));
    expect(missing, `not ported: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('TFG landforms produce sane terrain', () => {
  const seed = 12345n;
  const sample = (fn: (x: number, z: number) => number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 400; i++) out.push(fn(i * 13, i * 29));
    return out;
  };

  it('keeps flats flat, and just above sea level', () => {
    const values = sample((x, z) => tfgNoise.flats(seed).noiseAt(x, z));
    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(tfgNoise.SEA_LEVEL_Y);
      expect(value).toBeLessThanOrEqual(tfgNoise.SEA_LEVEL_Y + 2);
    }
  });

  it('keeps salt flats below sea level, which is what keeps them damp', () => {
    const values = sample((x, z) => tfgNoise.saltFlats(seed).noiseAt(x, z));
    for (const value of values) {
      expect(value).toBeLessThanOrEqual(tfgNoise.SEA_LEVEL_Y);
      expect(value).toBeGreaterThanOrEqual(tfgNoise.SEA_LEVEL_Y - 2);
    }
  });

  it('makes karst add to its base and sinkholes subtract from it', () => {
    // The direction is the whole point: fenglin builds towers up, cenotes cut holes down. Getting
    // a sign backwards gives terrain that still looks like terrain.
    const base = tfgNoise.constant(20);
    let towersAbove = 0;
    let holesBelow = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 13;
      const z = i * 29;
      if (tfgNoise.fenglin(seed, base, 40).noiseAt(x, z) > base.noiseAt(x, z)) towersAbove++;
      if (tfgNoise.cenotes(seed, base, 30, 40).noiseAt(x, z) < base.noiseAt(x, z)) holesBelow++;
    }
    expect(towersAbove).toBeGreaterThan(0);
    expect(holesBelow).toBeGreaterThan(0);
  });

  it('never returns a non-finite height from any landform', () => {
    // A NaN propagates silently through the 7x7 blend and blanks a whole region.
    const hotspots = hotspotFields(seed);
    const hotspot = tfgNoise.chain((x, z) => hotspots.intensityAtBlock(x, z));
    const base = tfgNoise.constant(10);
    const landforms: readonly [string, (x: number, z: number) => number][] = [
      ['dunes', (x, z) => tfgNoise.dunes(seed, 2, 30).noiseAt(x, z)],
      ['sharpHills', (x, z) => tfgNoise.sharpHills(seed, 10, 40).noiseAt(x, z)],
      ['badlands', (x, z) => tfgNoise.badlands(seed, 12, 20).noiseAt(x, z)],
      ['rockyIslands', (x, z) => tfgNoise.rockyIslands(seed).noiseAt(x, z)],
      ['mesas', (x, z) => tfgNoise.mesas(seed).noiseAt(x, z)],
      ['hoodoos', (x, z) => tfgNoise.hoodoos(seed).noiseAt(x, z)],
      ['fengcong', (x, z) => tfgNoise.fengcong(seed, base).noiseAt(x, z)],
      ['shilin', (x, z) => tfgNoise.shilin(seed, base, 30).noiseAt(x, z)],
      ['burren', (x, z) => tfgNoise.burren(seed, base, 8).noiseAt(x, z)],
      ['bowlDolines', (x, z) => tfgNoise.bowlDolines(seed, base, 20).noiseAt(x, z)],
      ['tiankeng', (x, z) => tfgNoise.tiankeng(seed, base).noiseAt(x, z)],
      ['drumlins', (x, z) => tfgNoise.drumlins(seed).noiseAt(x, z)],
      ['knobAndKettle', (x, z) => tfgNoise.knobAndKettle(seed).noiseAt(x, z)],
      ['glacialCirques', (x, z) => tfgNoise.glacialCirques(seed).noiseAt(x, z)],
      ['patternedGround', (x, z) => tfgNoise.patternedGround(seed).noiseAt(x, z)],
      ['stoneCircles', (x, z) => tfgNoise.stoneCircles(seed).noiseAt(x, z)],
      ['glacialSurfaceTexture', (x, z) => tfgNoise.glacialSurfaceTexture(seed).noiseAt(x, z)],
      ['activeShieldVolcano', (x, z) => tfgNoise.activeShieldVolcano(seed, hotspot).noiseAt(x, z)],
      ['sunkenShieldVolcano', (x, z) => tfgNoise.sunkenShieldVolcano(seed, hotspot).noiseAt(x, z)],
      ['ancientShieldVolcano', (x, z) => tfgNoise.ancientShieldVolcano(seed, 40, 90, hotspot).noiseAt(x, z)],
    ];
    for (const [name, fn] of landforms) {
      for (const value of sample(fn)) {
        expect(Number.isFinite(value), `${name} produced ${value}`).toBe(true);
      }
    }
  });
});
