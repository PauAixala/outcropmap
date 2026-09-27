/**
 * Unit coverage for the tfc-1.20 biome port that isn't a fixture comparison (see
 * tests/parity/tfc-1.20-biomes.parity.test.ts for bit-exact checks against real TFC source):
 * determinism, and that every id this port can ever return is a real datapack biome id — an id
 * that isn't would silently point a player at a biome that doesn't exist (AGENTS.md section 2).
 */
import '../../src/worldgen/profiles';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { biomeId, Biome } from '../../src/worldgen/tfc-1.20/biome/ids';

const biomesJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/data/tfc-1.20/biomes.json',
);
const biomesData: { biomes: Record<string, unknown> } = JSON.parse(readFileSync(biomesJsonPath, 'utf8'));
const KNOWN_BIOME_IDS = new Set(Object.keys(biomesData.biomes));

const paletteJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/data/palettes/tfc-1.20-biomes.json',
);
const paletteData: { colors: Record<string, number> } = JSON.parse(readFileSync(paletteJsonPath, 'utf8'));

const SAMPLE_SEEDS = [0n, 1n, -1n, 123456789n, 2n ** 62n];
const SAMPLE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, -1],
  [1000, 2000],
  [-5000, 3000],
  [123_456, -654_321],
  [-1_000_000, 1_000_000],
  [17, 4001],
  [-8_192, -8_192],
];

describe('tfc-1.20 biome: determinism', () => {
  it('the same seed and position give the same biome for a fresh generator instance', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      const b = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (const [x, z] of SAMPLE_POSITIONS) {
        expect(a.biome(x, z)).toBe(b.biome(x, z));
      }
    }
  });

  it('repeated queries against the same generator instance are stable', () => {
    const generator = createGenerator('tfc-1.20', { seed: 42n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      const first = generator.biome(x, z);
      const second = generator.biome(x, z);
      expect(second).toBe(first);
    }
  });

  it('a non-integer block position floors to the same biome as its containing block', () => {
    const generator = createGenerator('tfc-1.20', { seed: 9n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      expect(generator.biome(x + 0.5, z + 0.75)).toBe(generator.biome(x, z));
    }
  });

  it('different seeds produce different biomes somewhere in a sample of positions', () => {
    // Not a proof of non-collision, just a smoke check that the seed is actually wired in.
    const genA = createGenerator('tfc-1.20', { seed: 1n, dimension: 'overworld' });
    const genB = createGenerator('tfc-1.20', { seed: 2n, dimension: 'overworld' });
    const differs = SAMPLE_POSITIONS.some(([x, z]) => genA.biome(x, z) !== genB.biome(x, z));
    expect(differs).toBe(true);
  });
});

describe('tfc-1.20 biome: id validity', () => {
  it('src/data/tfc-1.20/biomes.json actually lists every id the internal Biome enum can produce', () => {
    // Guards the fixture below against a hollow pass: if biomes.json were empty or stale, every
    // "id is known" assertion would trivially fail loudly instead of trivially passing.
    expect(KNOWN_BIOME_IDS.size).toBeGreaterThan(0);
    for (let value = Biome.OCEAN; value <= Biome.PLATEAU_LAKE; value++) {
      expect(KNOWN_BIOME_IDS.has(biomeId(value))).toBe(true);
    }
  });

  it('every biome the generator returns across many seeds and positions is a real datapack biome id', () => {
    const wideSeeds = [0n, 1n, -1n, 7n, 42n, 123456789n, -987654321n, 2n ** 62n, -(2n ** 62n)];
    const step = 733; // an odd stride, so sampled positions don't all land on the same quart parity
    let sampled = 0;
    for (const seed of wideSeeds) {
      const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (let i = -6; i <= 6; i++) {
        const x = i * step * 97;
        const z = i * step * 53;
        const biome = generator.biome(x, z);
        expect(biome).not.toBeNull();
        expect(KNOWN_BIOME_IDS.has(biome as string)).toBe(true);
        sampled++;
      }
    }
    expect(sampled).toBeGreaterThan(50);
  });

  it('every id the biome palette covers is itself a real datapack biome id (no stale/typoed keys)', () => {
    for (const id of Object.keys(paletteData.colors)) {
      expect(KNOWN_BIOME_IDS.has(id)).toBe(true);
    }
  });

  it('the biome palette covers every id the internal Biome enum can produce (no missing colour falls back to a hash)', () => {
    for (let value = Biome.OCEAN; value <= Biome.PLATEAU_LAKE; value++) {
      const id = biomeId(value);
      expect(paletteData.colors[id]).toBeTypeOf('number');
    }
  });
});
