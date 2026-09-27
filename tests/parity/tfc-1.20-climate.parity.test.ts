/**
 * Checks the TFC 1.20 climate port against `tests/fixtures/tfc-1.20/climate-components.json` —
 * captured by compiling and running actual TFC/FastNoiseLite source (`tools/parity/capture-tfc-climate.mjs`)
 * on a real JDK, not an independent reimplementation. See that fixture's own `"source"` field and
 * `docs/PARITY.md` for exactly which classes were compiled and which pieces are minimal shims
 * (`net.minecraft.util.Mth`, `it.unimi.dsi.fastutil.HashCommon`, unused NBT/network stubs).
 *
 *   "noise"       -> OpenSimplex2D.noise (real OpenSimplex2D.java + FastNoiseLite.java)
 *   "cell"        -> Cellular2D.cell (real Cellular2D.java + FastNoiseLite.java)
 *   "base"        -> RegionGenerator's real temperatureNoise/rainfallNoise constructor expressions
 *   "correction"  -> AnnotateClimate.apply's bias-correction math (real AnnotateClimate.java)
 *   "lerp"        -> LerpFloatLayer.scaled + getValue (real LerpFloatLayer.java + Helpers.lerp4)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenSimplex2D } from '@worldgen/tfc-1.20/noise/open-simplex-2d';
import { Cellular2D } from '@worldgen/tfc-1.20/noise/cellular-2d';
import { add, scaled } from '@worldgen/tfc-1.20/noise/noise2d';
import { baseNoise } from '@worldgen/tfc-1.20/region/generator';
import { Region, RegionPoint } from '@worldgen/tfc-1.20/region/region';
import { annotateClimate, createFootprint, type RegionBuildContext } from '@worldgen/tfc-1.20/region/tasks';
import { scaledCorners, getValue } from '@worldgen/tfc-1.20/climate/index';
import type { RandomSource } from '@core/random';

type NoiseCase = { kind: 'noise'; seed: number; octaves: number; x: number; z: number; value: number };
type CellCase = { kind: 'cell'; seed: string; x: number; z: number; value: [number, number, number, number, number, number, number] };
type BaseCase = { kind: 'base'; seed: number; scale: number; constant: number; x: number; z: number; temperature: number; rainfall: number };
type CorrectionCase = { kind: 'correction'; temperature: number; rainfall: number; land: boolean; edge: number; ocean: number; value: [number, number] };
type LerpCase = { kind: 'lerp'; dx: number; dz: number; x: number; z: number; value: number };
type Case = NoiseCase | CellCase | BaseCase | CorrectionCase | LerpCase;

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tfc-1.20/climate-components.json');
const fixture: { source: string; revision: string; cases: Case[] } = JSON.parse(readFileSync(fixturePath, 'utf8'));

const noiseCases = fixture.cases.filter((c): c is NoiseCase => c.kind === 'noise');
const cellCases = fixture.cases.filter((c): c is CellCase => c.kind === 'cell');
const baseCases = fixture.cases.filter((c): c is BaseCase => c.kind === 'base');
const correctionCases = fixture.cases.filter((c): c is CorrectionCase => c.kind === 'correction');
const lerpCases = fixture.cases.filter((c): c is LerpCase => c.kind === 'lerp');

describe('TFC 1.20 climate parity (real JDK-compiled TFC source, see docs/PARITY.md)', () => {
  it('fixture is non-empty and covers every case kind', () => {
    expect(noiseCases.length).toBeGreaterThan(0);
    expect(cellCases.length).toBeGreaterThan(0);
    expect(baseCases.length).toBeGreaterThan(0);
    expect(correctionCases.length).toBeGreaterThan(0);
    expect(lerpCases.length).toBeGreaterThan(0);
  });

  describe('OpenSimplex2D.noise (real OpenSimplex2D.java + FastNoiseLite.java)', () => {
    for (const c of noiseCases) {
      it(`seed=${c.seed} octaves=${c.octaves} x=${c.x} z=${c.z}`, () => {
        const actual = new OpenSimplex2D(c.seed).octaves(c.octaves).spread(0.15).noise(c.x, c.z);
        expect(actual).toBe(c.value);
      });
    }
  });

  describe('Cellular2D.cell (real Cellular2D.java + FastNoiseLite.java)', () => {
    for (const c of cellCases) {
      it(`seed=${c.seed} x=${c.x} z=${c.z}`, () => {
        // `1f / 96` in the fixture capture (`tools/parity/capture-tfc-climate.mjs`) is a Java float
        // division, widened to double only after rounding — not the same double as `1 / 96` computed
        // directly (see `../../src/worldgen/tfc-1.20/region/generator.ts`'s constructor comment).
        const cell = new Cellular2D(BigInt(c.seed)).spread(Math.fround(1 / 96)).cell(c.x, c.z);
        const [x, y, cx, cy, f1, f2, noise] = c.value;
        expect(cell.x).toBe(x);
        expect(cell.y).toBe(y);
        expect(cell.cx).toBe(cx);
        expect(cell.cy).toBe(cy);
        expect(cell.f1).toBe(f1);
        expect(cell.f2).toBe(f2);
        expect(cell.noise).toBe(noise);
      });
    }
  });

  describe('RegionGenerator temperatureNoise/rainfallNoise construction', () => {
    for (const c of baseCases) {
      it(`seed=${c.seed} scale=${c.scale} constant=${c.constant} x=${c.x} z=${c.z}`, () => {
        // Mirrors the fixture's stub `RegionGenerator(Settings, int temperatureSeed, int
        // rainfallSeed)`, whose fake `Seeds` random source returns `temperatureSeed` then
        // `rainfallSeed` for its two `nextInt()` draws — i.e. exactly this generator's own
        // `temperatureNoise`/`rainfallNoise` construction (`./generator.ts`), with the
        // `XoroshiroRandomSource`-derived seeds replaced by direct values.
        const temperatureSimplex = new OpenSimplex2D(c.seed).octaves(2).spread(Math.fround(0.15)).scaled(-3, 3);
        const temperatureNoise = add(scaled(baseNoise(false, c.scale, c.constant), -20, 30), (x, z) => temperatureSimplex.noise(x, z));

        const rainfallSeed = ~c.seed;
        const rainfallSimplex = new OpenSimplex2D(rainfallSeed).octaves(2).spread(Math.fround(0.15)).scaled(-80, 40);
        const rainfallNoise = add(scaled(baseNoise(true, c.scale, c.constant), 0, 500), (x, z) => rainfallSimplex.noise(x, z));

        expect(temperatureNoise(c.x, c.z)).toBe(c.temperature);
        expect(rainfallNoise(c.x, c.z)).toBe(c.rainfall);
      });
    }
  });

  describe('AnnotateClimate bias correction (real AnnotateClimate.java)', () => {
    for (const c of correctionCases) {
      it(`temp=${c.temperature} rain=${c.rainfall} land=${c.land} edge=${c.edge}`, () => {
        // A minimal one-point region: temperatureNoise/rainfallNoise are constant functions
        // returning the fixture's pre-set initial values (annotateClimate overwrites
        // point.temperature/rainfall from them, exactly as AnnotateClimate.java does), and
        // land/distanceToEdge/distanceToOcean are set directly on the point beforehand, since
        // AnnotateClimate only *reads* those three fields.
        const cell = { x: 0, y: 0, cx: 0, cy: 0, f1: 0, f2: 0, noise: 0 };
        const region = new Region(cell);
        const point: RegionPoint = region.atInit(region.minX, region.minZ);
        region.setRegionArea([point], region.minX, region.minZ, region.minX, region.minZ);

        if (c.land) point.setLand();
        point.distanceToEdge = c.edge;
        point.distanceToOcean = c.ocean;

        const dummyRandom = {} as RandomSource;
        const ctx: RegionBuildContext = {
          region,
          regionCell: cell,
          random: dummyRandom,
          sampleCell: () => cell,
          continentNoise: () => 0,
          temperatureNoise: () => c.temperature,
          rainfallNoise: () => c.rainfall,
          ...createFootprint(),
        };

        annotateClimate(ctx);

        const [expectedTemperature, expectedRainfall] = c.value;
        expect(point.temperature).toBe(expectedTemperature);
        expect(point.rainfall).toBe(expectedRainfall);
      });
    }
  });

  describe('LerpFloatLayer.scaled + getValue (real LerpFloatLayer.java + Helpers.lerp4)', () => {
    // Java float literals: `new LerpFloatLayer(-22.13f, 32.7f, 14.37f, -3.11f)` — the stored
    // value is each literal rounded to float32, not the exact double.
    const V00 = Math.fround(-22.13);
    const V01 = Math.fround(32.7);
    const V10 = Math.fround(14.37);
    const V11 = Math.fround(-3.11);
    for (const c of lerpCases) {
      it(`dx=${c.dx} dz=${c.dz} x=${c.x} z=${c.z}`, () => {
        const corners = scaledCorners(V00, V01, V10, V11, c.dx, c.dz, 0.125);
        const actual = getValue(corners, c.x / 16, c.z / 16);
        expect(actual).toBe(c.value);
      });
    }
  });
});
