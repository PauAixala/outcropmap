/**
 * Checks the TFC 1.20 biome-assignment port against `tests/fixtures/tfc-1.20/biomes.json` —
 * captured by compiling and running the actual `RegionGenerator` full task pipeline (every real
 * `Task`, including `ADD_RIVERS_AND_LAKES`) and `TFCLayers.createRegionBiomeLayer`
 * (`tools/parity/capture-tfc-biomes.mjs`) on a real JDK, not an independent reimplementation. See
 * that fixture's own `"source"` field and `docs/PARITY.md`.
 *
 * Two levels of the pipeline are checked, both against the *same* seed the fixture used:
 *
 *  - "points": every `Region.Point` field `AddMountains`/`AnnotateBiomeAltitude`/`ChooseBiomes`
 *    write, at grid scale, including the resulting `.biome` id — plus `.rock`, `ChooseRocks`'s
 *    packed category+area-seed int (`src/worldgen/tfc-1.20/rock/`'s `RegionGenerator.rockAt` reads
 *    this same field at block scale; this test is what makes `chooseRocks` itself, as opposed to
 *    the rock *layer tree* on top of it, fixture-verified — see docs/PARITY.md).
 *  - "quarts": `generator.biomeAtQuart(quartX, quartZ)` end-to-end, using this generator's own
 *    internally-derived biome-layer seed — this also verifies the `RandomSource` draw order through
 *    `biomeArea`/`rockArea`/the discarded chunk-data seed lines up with the real
 *    `TFCChunkGenerator.initRandomState`, not just `TFCLayers.createRegionBiomeLayer` in isolation.
 *
 * `AddRiversAndLakes` **is** ported as of 2026-09-10 (plan section 7,
 * `src/worldgen/tfc-1.20/region/add-rivers-and-lakes.ts`), and with it this fixture matches the real
 * generator **exactly** — every grid point and every quart, on all three seeds. Both assertions
 * below used to tolerate a lake-shaped gap: the real generator's pipeline runs `AddRiversAndLakes`
 * after `ChooseBiomes`, overwriting some biomes with their lake variants and rippling one hop
 * through `RegionEdgeBiomeLayer`'s neighbour check. Now that lakes place in the right cells, that
 * gap is zero and the tolerances are gone rather than left as slack a future bug could hide in.
 *
 * The bug that gap was hiding, found by re-running this test after the port: `isLegal` compares
 * against `Math.min(3, prev.distance() / 2)`, and `distance()` is an `int`, so that division is
 * **integer** division. Doing it in floating point raised the threshold by a half for odd distances
 * and let rivers run one step further than the game allows — which moved their sources, and so the
 * lakes placed around them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegionGenerator, type RegionGeneratorSettings } from '@worldgen/tfc-1.20/region/generator';

interface PointCase {
  readonly x: number;
  readonly z: number;
  readonly biome: number;
  readonly rock: number;
  readonly edge: number;
  readonly ocean: number;
  readonly landHeight: number;
  readonly oceanDepth: number;
  readonly altitude: number;
  readonly land: boolean;
  readonly island: boolean;
  readonly mountain: boolean;
  readonly coastalMountain: boolean;
}

interface FixtureCase {
  readonly seed: string;
  readonly biomeSeed: string;
  readonly points: readonly PointCase[];
  readonly quarts: ReadonlyArray<readonly [number, number, number]>;
}

interface Fixture {
  readonly source: string;
  readonly revision: string;
  readonly biomeIds: readonly string[];
  readonly cases: readonly FixtureCase[];
}

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tfc-1.20/biomes.json');
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

// The real biome ids `TFCLayers.hasLake`/`lakeFor` can ever produce as an `AddRiversAndLakes`
// overwrite (see this file's header) — a fixture value of one of these is eligible for the
// documented, unported-rivers divergence; any other value must match this port exactly.

// The capture harness (`tools/parity/capture-tfc-biomes.mjs`) always builds
// `new Settings(20000, 0, 20000, 0, .5f)` — the same default settings this project's tfc-1.20
// profile uses (`src/worldgen/tfc-1.20/index.ts`).
const DEFAULT_SETTINGS: RegionGeneratorSettings = {
  temperatureScale: 20_000,
  temperatureConstant: 0,
  rainfallScale: 20_000,
  rainfallConstant: 0,
  continentalness: 0.5,
};

describe('TFC 1.20 biome parity (real JDK-compiled TFC source, see docs/PARITY.md)', () => {
  it('fixture is non-empty and covers both grid-scale points and quart-scale layer samples', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) {
      expect(c.points.length).toBeGreaterThan(0);
      expect(c.quarts.length).toBeGreaterThan(0);
    }
  });

  for (const testCase of fixture.cases) {
    describe(`seed=${testCase.seed}`, () => {
      const generator = new RegionGenerator(BigInt(testCase.seed), DEFAULT_SETTINGS);

      it('grid-scale Region.Point fields match real AddMountains/AnnotateBiomeAltitude output exactly', () => {
        for (const p of testCase.points) {
          const point = generator.getOrCreateRegionPoint(p.x, p.z);
          expect(point.land()).toBe(p.land);
          expect(point.island()).toBe(p.island);
          expect(point.mountain()).toBe(p.mountain);
          expect(point.coastalMountain()).toBe(p.coastalMountain);
          expect(point.distanceToEdge).toBe(p.edge);
          expect(point.distanceToOcean).toBe(p.ocean);
          expect(point.baseLandHeight).toBe(p.landHeight);
          expect(point.baseOceanDepth).toBe(p.oceanDepth);
          expect(point.biomeAltitude).toBe(p.altitude);
          // `ChooseRocks.apply`'s packed category+area-seed value — see this file's header.
          expect(point.rock).toBe(p.rock);
        }
      });

      it('grid-scale ChooseBiomes output matches the real generator exactly', () => {
        // Exact since AddRiversAndLakes was ported (plan section 7). This assertion used to
        // tolerate a lake-shaped gap; that gap is now zero on every fixture seed, so the tolerance
        // is gone rather than left as dead slack for a future bug to hide in.
        const mismatches: string[] = [];
        for (const p of testCase.points) {
          const point = generator.getOrCreateRegionPoint(p.x, p.z);
          if (point.biome === p.biome) continue;
          mismatches.push(
            `(${p.x},${p.z}) expected ${fixture.biomeIds[p.biome]} got ${fixture.biomeIds[point.biome]}`,
          );
        }
        expect(mismatches).toEqual([]);
      });

      it('quart-scale biomeAtQuart matches TFCLayers.createRegionBiomeLayer exactly', () => {
        // Also exact since section 7 landed. The old tolerance covered both the lake overwrite and
        // the one-hop `RegionEdgeBiomeLayer` ripple onto a neighbouring quart; with lakes placed in
        // the right cells, both disappear.
        const mismatches: string[] = [];
        for (const [quartX, quartZ, expected] of testCase.quarts) {
          const actual = generator.biomeAtQuart(quartX, quartZ);
          if (actual === expected) continue;
          mismatches.push(
            `(${quartX},${quartZ}) expected ${fixture.biomeIds[expected]} got ${fixture.biomeIds[actual]}`,
          );
        }
        expect(mismatches).toEqual([]);
      });
    });
  }
});
