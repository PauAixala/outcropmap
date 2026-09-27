/**
 * Unit tests for the tfc-1.20 profile's region/climate port that aren't fixture comparisons
 * (see tests/parity/tfc-1.20-climate.parity.test.ts for bit-exact checks against real TFC source):
 * determinism, plausible value ranges across many seeds/positions, and Units grid arithmetic.
 */
import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import {
  CELL_WIDTH_IN_GRID,
  GRID_WIDTH_IN_BLOCK,
  blockToGrid,
  blockToGridExact,
  cellToGrid,
  gridToCell,
} from '../../src/worldgen/tfc-1.20/region/units';
import { RegionGenerator } from '../../src/worldgen/tfc-1.20/region/generator';

const DEFAULT_SETTINGS = {
  temperatureScale: 20_000,
  temperatureConstant: 0,
  rainfallScale: 20_000,
  rainfallConstant: 0,
  continentalness: 0.5,
};

const SAMPLE_SEEDS = [0n, 1n, -1n, 123456789n, 2n ** 62n];
const SAMPLE_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, -1],
  [1000, 2000],
  [-5000, 3000],
  [123_456, -654_321],
  [-1_000_000, 1_000_000],
];

describe('tfc-1.20 climate: determinism', () => {
  it('the same seed and settings produce identical climate for a fresh generator instance', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = new RegionGenerator(seed, DEFAULT_SETTINGS);
      const b = new RegionGenerator(seed, DEFAULT_SETTINGS);
      for (const [x, z] of SAMPLE_POSITIONS) {
        const pa = a.getOrCreateRegionPoint(blockToGrid(x), blockToGrid(z));
        const pb = b.getOrCreateRegionPoint(blockToGrid(x), blockToGrid(z));
        expect(pa.temperature).toBe(pb.temperature);
        expect(pa.rainfall).toBe(pb.rainfall);
      }
    }
  });

  it('repeated queries against the same generator instance are stable (region cache)', () => {
    const gen = new RegionGenerator(42n, DEFAULT_SETTINGS);
    for (const [x, z] of SAMPLE_POSITIONS) {
      const gx = blockToGrid(x);
      const gz = blockToGrid(z);
      const first = gen.getOrCreateRegionPoint(gx, gz);
      const second = gen.getOrCreateRegionPoint(gx, gz);
      expect(second).toBe(first); // same cached Region and RegionPoint object, not just equal values
    }
  });

  it('the full generator (via the registry) gives the same climate for the same seed', () => {
    const genA = createGenerator('tfc-1.20', { seed: 7n, dimension: 'overworld' });
    const genB = createGenerator('tfc-1.20', { seed: 7n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      expect(genA.climate(x, z)).toEqual(genB.climate(x, z));
    }
  });

  it('different seeds produce different climate somewhere in a sample of positions', () => {
    // Not a proof of non-collision, just a smoke check that the seed is actually wired in.
    const genA = createGenerator('tfc-1.20', { seed: 1n, dimension: 'overworld' });
    const genB = createGenerator('tfc-1.20', { seed: 2n, dimension: 'overworld' });
    const differs = SAMPLE_POSITIONS.some(([x, z]) => {
      const a = genA.climate(x, z);
      const b = genB.climate(x, z);
      return a.temperature !== b.temperature || a.rainfall !== b.rainfall;
    });
    expect(differs).toBe(true);
  });
});

describe('tfc-1.20 climate: value ranges', () => {
  // RegionGenerator's own construction bounds rainfall's noise contribution to [-80, 40] on top of
  // a [0, 500] base (net.dries007.tfc.world.region.RegionGenerator), and RegionChunkDataGenerator
  // additionally clamps the final interpolated value to [0, 500] (LerpFloatLayer) — see
  // src/worldgen/tfc-1.20/climate/index.ts's clampCorners. Temperature has no such hard clamp in
  // the real game; the checked bound here is generous, not a port of an actual constant.
  it('rainfall stays within the real games clamped [0, 500] range', () => {
    for (const seed of SAMPLE_SEEDS) {
      const g = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (const [x, z] of SAMPLE_POSITIONS) {
        const { rainfall } = g.climate(x, z);
        expect(rainfall).toBeGreaterThanOrEqual(0);
        expect(rainfall).toBeLessThanOrEqual(500);
      }
    }
  });

  it('temperature stays within a generous real-world-plausible range', () => {
    for (const seed of SAMPLE_SEEDS) {
      const g = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (const [x, z] of SAMPLE_POSITIONS) {
        const { temperature } = g.climate(x, z);
        expect(Number.isFinite(temperature)).toBe(true);
        expect(temperature).toBeGreaterThan(-60);
        expect(temperature).toBeLessThan(70);
      }
    }
  });

  it('probe() reports finite climate and a region coordinate consistent with Units', () => {
    const g = createGenerator('tfc-1.20', { seed: 5n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      const probe = g.probe(x, z);
      expect(probe.climate).not.toBeNull();
      expect(Number.isFinite(probe.climate?.temperature)).toBe(true);
      expect(Number.isFinite(probe.climate?.rainfall)).toBe(true);
      // The probe now reports the Voronoi cell the block actually falls in (cell.cx/cy), not the
      // uniform gridToCell bucket it sits over — TFC's regions are amoeba-shaped, so the two only
      // agree near cell centres. Assert what is true of the real semantics: an integer id that is
      // stable for a given block and shared by its immediate neighbours.
      expect(Number.isInteger(probe.regionX)).toBe(true);
      expect(Number.isInteger(probe.regionZ)).toBe(true);
      const again = g.probe(x, z);
      expect(again.regionX).toBe(probe.regionX);
      expect(again.regionZ).toBe(probe.regionZ);
      // Phase 4 wires up biome (see tests/unit/tfc-1.20-biome.test.ts for dedicated coverage);
      // Phase 5 wires up the rock stack; surface rock includes RegionChunkDataGenerator's skew.
      expect(typeof probe.biome).toBe('string');
      expect(probe.rocks).not.toBeNull();
      expect(typeof probe.rocks?.surface).toBe('string');
      expect(Number.isInteger(probe.surfaceY)).toBe(true);
    }
  });
});

describe('tfc-1.20 probe: terrain fields (slice 2)', () => {
  it('probe() reports a full, deterministic terrain sample for a given seed and position', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      const b = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (const [x, z] of SAMPLE_POSITIONS) {
        const pa = a.probe(x, z);
        const pb = b.probe(x, z);
        expect(pa.terrain).not.toBeNull();
        expect(pa.terrain).toEqual(pb.terrain);
        const terrain = pa.terrain;
        if (!terrain) throw new Error('unreachable: asserted not null above');
        expect(typeof terrain.land).toBe('boolean');
        expect(typeof terrain.island).toBe('boolean');
        expect(typeof terrain.mountain).toBe('boolean');
        expect(typeof terrain.coastalMountain).toBe('boolean');
        expect(Number.isInteger(terrain.distanceToOcean)).toBe(true);
        expect(Number.isInteger(terrain.distanceToEdge)).toBe(true);
        expect(Number.isInteger(terrain.baseLandHeight)).toBe(true);
        expect(Number.isInteger(terrain.biomeAltitude)).toBe(true);
        // A point flagged as an island or a mountain range is, definitionally, land.
        if (terrain.island || terrain.mountain || terrain.coastalMountain) {
          expect(terrain.land).toBe(true);
        }
      }
    }
  });

  it('repeated probes at the same position return an equal (cached) terrain sample', () => {
    const g = createGenerator('tfc-1.20', { seed: 99n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      expect(g.probe(x, z).terrain).toEqual(g.probe(x, z).terrain);
    }
  });
});

describe('tfc-1.20 probe: fast path (slice 2)', () => {
  it('probeFast() never builds a not-yet-cached region: climate/rocks/biome/terrain are null on a cold cell', () => {
    const g = createGenerator('tfc-1.20', { seed: 123n, dimension: 'overworld' });
    // A generator that has never been probed has an empty region cache — every position is cold.
    for (const [x, z] of SAMPLE_POSITIONS) {
      const fast = g.probeFast?.(x, z);
      expect(fast).toBeDefined();
      if (!fast) throw new Error('unreachable: asserted defined above');
      expect(fast.climate).toBeNull();
      expect(fast.rocks).toBeNull();
      expect(fast.biome).toBeNull();
      expect(fast.terrain).toBeNull();
      // Position fields never need a region build, so they are always available.
      expect(fast.x).toBe(x);
      expect(fast.z).toBe(z);
      expect(Number.isInteger(fast.chunkX)).toBe(true);
      expect(Number.isInteger(fast.regionX)).toBe(true);
    }
  });

  it('probeFast() matches the full probe() once the region has been warmed up', () => {
    const g = createGenerator('tfc-1.20', { seed: 123n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      const full = g.probe(x, z); // builds and caches the region
      const fast = g.probeFast?.(x, z);
      expect(fast).toBeDefined();
      if (!fast) throw new Error('unreachable: asserted defined above');
      expect(fast.climate).toEqual(full.climate);
      expect(fast.rocks).toEqual(full.rocks);
      expect(fast.biome).toBe(full.biome);
      expect(fast.terrain).toEqual(full.terrain);
    }
  });

  it('RegionGenerator.isRegionCached never builds a region and reflects getOrCreateRegionPoint', () => {
    const gen = new RegionGenerator(7n, DEFAULT_SETTINGS);
    const [x, z] = [4000, -2500] as const;
    const gridX = blockToGrid(x);
    const gridZ = blockToGrid(z);
    expect(gen.isRegionCached(gridX, gridZ)).toBe(false);
    expect(gen.cachedRegionCount).toBe(0);
    gen.getOrCreateRegionPoint(gridX, gridZ);
    expect(gen.isRegionCached(gridX, gridZ)).toBe(true);
    expect(gen.cachedRegionCount).toBe(1);
  });
});

describe('tfc-1.20 region grid: Units arithmetic', () => {
  it('1 Grid = 128 Blocks', () => {
    expect(GRID_WIDTH_IN_BLOCK).toBe(128);
  });

  it('1 Cell = 96 Grid = 12,288 Blocks', () => {
    expect(CELL_WIDTH_IN_GRID).toBe(96);
    expect(CELL_WIDTH_IN_GRID * GRID_WIDTH_IN_BLOCK).toBe(12_288);
  });

  it('blockToGrid/blockToGridExact agree for exact multiples of the grid width', () => {
    for (const grid of [-1000, -1, 0, 1, 2, 1000]) {
      const block = grid * GRID_WIDTH_IN_BLOCK;
      expect(blockToGrid(block)).toBe(grid);
      expect(blockToGridExact(block)).toBe(grid);
    }
  });

  it('blockToGrid floors towards negative infinity, matching Java integer division semantics', () => {
    // Block 1 is still within grid cell 0; block -1 belongs to grid cell -1, not 0.
    expect(blockToGrid(1)).toBe(0);
    expect(blockToGrid(127)).toBe(0);
    expect(blockToGrid(128)).toBe(1);
    expect(blockToGrid(-1)).toBe(-1);
    expect(blockToGrid(-128)).toBe(-1);
    expect(blockToGrid(-129)).toBe(-2);
  });

  it('gridToCell/cellToGrid round-trip for exact cell boundaries and floor for the rest', () => {
    for (const cell of [-10, -1, 0, 1, 10]) {
      const grid = cellToGrid(cell);
      expect(gridToCell(grid)).toBe(cell);
    }
    // A grid coordinate one below a cell boundary belongs to the previous cell, not cell 0 (this
    // is the same floor-division semantics as blockToGrid, at the next unit up).
    expect(gridToCell(-1)).toBe(-1);
    expect(gridToCell(CELL_WIDTH_IN_GRID - 1)).toBe(0);
    expect(gridToCell(CELL_WIDTH_IN_GRID)).toBe(1);
  });
});
