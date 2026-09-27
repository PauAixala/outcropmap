/**
 * Checks the TFC 1.20 rock-layer port against `tests/fixtures/tfc-1.20/rocks.json` -- captured by
 * compiling and running the actual `TFCLayers.createOverworldRockLayer` and
 * `RockLayerSettings.sampleAtLayer` on a real JDK, not an independent reimplementation
 * (`tools/parity/capture-tfc-rocks.mjs`). See that fixture's own `"source"` field and
 * docs/PARITY.md.
 *
 * Two things are checked, both bit-exact (no tolerance, unlike the biome parity test — nothing
 * here depends on the unported AddRiversAndLakes):
 *
 *  - "blocks": `RegionGenerator.rockAt(blockX, blockZ)` against the real
 *    `TFCLayers.createOverworldRockLayer` output at the same seed -- this also verifies the
 *    `RandomSource` draw order through `biomeArea`/`rockArea`/the chunk-data seed re-derivation
 *    lines up with the real `RegionChunkDataGenerator.create`, not just the layer in isolation.
 *  - "samples": `sampleAtLayer(pointRock, layerN)` against the real `RockLayerSettings` for every
 *    captured `pointRock` value, at every depth the fixture recorded -- this is what makes the
 *    rock *layer tree* (`RockLayerSettings`'s recursive rock choices, not just `ChooseRocks`'s
 *    packed category+seed int, which tests/parity/tfc-1.20-biomes.parity.test.ts already covers)
 *    fixture-verified.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegionGenerator, type RegionGeneratorSettings } from '@worldgen/tfc-1.20/region/generator';
import { sampleAtLayer } from '@worldgen/tfc-1.20/rock/layer-settings';

interface SampleCase {
  readonly pointRock: number;
  readonly layerN: number;
  readonly id: string;
}

interface FixtureCase {
  readonly seed: string;
  readonly rockLayerSeed: string;
  readonly blocks: ReadonlyArray<readonly [number, number, number]>;
  readonly samples: readonly SampleCase[];
}

interface Fixture {
  readonly source: string;
  readonly revision: string;
  readonly cases: readonly FixtureCase[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tfc-1.20/rocks.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// The capture harness (`tools/parity/capture-tfc-rocks.mjs`) always builds
// `new Settings(20000, 0, 20000, 0, .5f)` -- the same default settings this project's tfc-1.20
// profile uses (`src/worldgen/tfc-1.20/index.ts`).
const DEFAULT_SETTINGS: RegionGeneratorSettings = {
  temperatureScale: 20_000,
  temperatureConstant: 0,
  rainfallScale: 20_000,
  rainfallConstant: 0,
  continentalness: 0.5,
};

describe('TFC 1.20 rock parity (real JDK-compiled TFC source, see docs/PARITY.md)', () => {
  it('fixture is non-empty and covers both block-scale samples and layer-tree samples', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      expect(c.blocks.length).toBeGreaterThan(0);
      expect(c.samples.length).toBeGreaterThan(0);
    }
  });

  for (const testCase of fixture.cases) {
    describe(`seed=${testCase.seed}`, () => {
      const generator = new RegionGenerator(BigInt(testCase.seed), DEFAULT_SETTINGS);

      it('block-scale rockAt matches TFCLayers.createOverworldRockLayer exactly', () => {
        for (const [x, z, expected] of testCase.blocks) {
          expect(generator.rockAt(x, z)).toBe(expected);
        }
      });

      it('sampleAtLayer matches the real RockLayerSettings tree traversal exactly', () => {
        for (const s of testCase.samples) {
          expect(sampleAtLayer(s.pointRock, s.layerN)).toBe(s.id);
        }
      });
    });
  }
});
