/**
 * Unit coverage for the tfc-1.20 rock layer port: determinism, and that every rock id this port
 * can ever return is a real datapack rock id (src/data/tfc-1.20/rocks.json) — an id that isn't
 * would silently point a player at a rock (and therefore an ore host) that doesn't exist
 * (AGENTS.md section 2). No fixture comparison here — see docs/PARITY.md for why a JDK-backed
 * fixture wasn't feasible for RockLayerSettings within this slice's scope.
 */
import '../../src/worldgen/profiles';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import {
  knownRockIds,
  sampleAtLayer,
  bottomDepthFor,
  rockStackAtPoint,
} from '../../src/worldgen/tfc-1.20/rock/layer-settings';
import type { RockStack } from '../../src/worldgen/api/types';

const rocksJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/data/tfc-1.20/rocks.json',
);
interface RockLayerEntry {
  readonly id: string;
  readonly entries: ReadonlyArray<readonly [string, string]>;
}
interface RockLayersJson {
  readonly bottom: readonly string[];
  readonly layers: readonly RockLayerEntry[];
  readonly oceanFloor: readonly string[];
  readonly land: readonly string[];
  readonly volcanic: readonly string[];
  readonly uplift: readonly string[];
}
const rocksData: { rocks: Record<string, unknown>; rockLayers: RockLayersJson } = JSON.parse(
  readFileSync(rocksJsonPath, 'utf8'),
);
const KNOWN_ROCK_IDS = new Set(Object.keys(rocksData.rocks));

/** Every rock id `rockLayers` (RockLayerSettings' own tree) actually names, whether as a "bottom"
 * entry or a `layers` entry's first tuple element — independent of `layer-settings.ts`'s own
 * `knownRockIds()`, so this test can't pass merely because both read the same field. */
function rockIdsInTree(): Set<string> {
  const ids = new Set<string>();
  for (const id of rocksData.rockLayers.bottom) ids.add(id);
  for (const layer of rocksData.rockLayers.layers) {
    for (const [rockId] of layer.entries) ids.add(rockId);
  }
  return ids;
}

const paletteJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/data/palettes/tfc-1.20-rocks.json',
);
const paletteData: { colors: Record<string, number> } = JSON.parse(
  readFileSync(paletteJsonPath, 'utf8'),
);

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

describe('tfc-1.20 rock: determinism', () => {
  it('the same seed and position give the same rock stack for a fresh generator instance', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      const b = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (const [x, z] of SAMPLE_POSITIONS) {
        expect(a.rocks(x, z)).toEqual(b.rocks(x, z));
      }
    }
  });

  it('repeated queries against the same generator instance are stable', () => {
    const generator = createGenerator('tfc-1.20', { seed: 42n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      const first = generator.rocks(x, z);
      const second = generator.rocks(x, z);
      expect(second).toEqual(first);
    }
  });

  it('a non-integer block position floors to the same rock stack as its containing block', () => {
    const generator = createGenerator('tfc-1.20', { seed: 9n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      expect(generator.rocks(x + 0.5, z + 0.75)).toEqual(generator.rocks(x, z));
    }
  });

  it('different seeds produce different rock stacks somewhere in a sample of positions', () => {
    // Not a proof of non-collision, just a smoke check that the seed is actually wired in.
    const genA = createGenerator('tfc-1.20', { seed: 1n, dimension: 'overworld' });
    const genB = createGenerator('tfc-1.20', { seed: 2n, dimension: 'overworld' });
    const differs = SAMPLE_POSITIONS.some(([x, z]) => {
      const a = genA.rocks(x, z);
      const b = genB.rocks(x, z);
      return a?.top !== b?.top || a?.middle !== b?.middle || a?.bottom !== b?.bottom;
    });
    expect(differs).toBe(true);
  });
});

/**
 * Guards docs/PLAN.md section 6's rock-sampling optimisation (`rockStackAtPoint`,
 * `src/worldgen/tfc-1.20/rock/layer-settings.ts`) against silently drifting from correct output.
 * `rockStackAtPoint` memoises the `{top, middle, bottom}` triple by `pointRock` -- this compares
 * it, for a whole block of distinct `pointRock` values (not just a handful of hand-picked ones),
 * against the straightforward, uncached computation (three direct `sampleAtLayer` calls) that was
 * this port's original implementation and remains the reference definition of "correct" here. If
 * a future change to the cache ever returns a stale or wrong value for some `pointRock`, this
 * fails without needing a JDK fixture, since both sides of the comparison are this port's own
 * code -- see tests/parity/tfc-1.20-rocks.parity.test.ts for the JDK-backed check that the
 * *reference* side itself stays correct.
 */
function straightforwardRockStack(pointRock: number): RockStack {
  return {
    top: sampleAtLayer(pointRock, 0),
    middle: sampleAtLayer(pointRock, 1),
    bottom: sampleAtLayer(pointRock, bottomDepthFor(pointRock)),
    surface: null,
  };
}

describe('rockStackAtPoint: the memoised path matches the straightforward one', () => {
  it('agrees with three direct sampleAtLayer calls across a block of distinct pointRock values', () => {
    // A block of pointRock values spanning all four type bits (OCEAN/VOLCANIC/LAND/UPLIFT) and a
    // wide spread of "area" seed values (the high bits) -- not filtered through the zoom stack, so
    // this is independent of any future change to rockAt/overworldRockLayer.
    let checked = 0;
    for (let base = -200; base <= 200; base++) {
      for (let type = 0; type < 4; type++) {
        const pointRock = (base << 2) | type;
        expect(rockStackAtPoint(pointRock)).toEqual(straightforwardRockStack(pointRock));
        checked++;
      }
    }
    expect(checked).toBe(401 * 4);
  });

  it('still matches the straightforward computation after the bounded cache has evicted and reloaded an entry', () => {
    const pointRock = (12_345 << 2) | 2;
    const before = rockStackAtPoint(pointRock);
    expect(before).toEqual(straightforwardRockStack(pointRock));
    // Touch far more distinct pointRock values than the cache's bound (4096), guaranteeing the
    // entry above was evicted at least once.
    for (let i = 0; i < 5000; i++) rockStackAtPoint((i << 2) | (i % 4));
    const after = rockStackAtPoint(pointRock);
    expect(after).toEqual(before);
    expect(after).toEqual(straightforwardRockStack(pointRock));
  });

  it('returns the same object reference on a cache hit (no per-call allocation in the hot path)', () => {
    const pointRock = (999 << 2) | 1;
    const a = rockStackAtPoint(pointRock);
    const b = rockStackAtPoint(pointRock);
    expect(a).toBe(b);
  });
});

describe('tfc-1.20 rock: surface sample', () => {
  it('returns the layer-zero surface sample with the stack', () => {
    const generator = createGenerator('tfc-1.20', { seed: 3n, dimension: 'overworld' });
    for (const [x, z] of SAMPLE_POSITIONS) {
      const rocks = generator.rocks(x, z);
      expect(rocks).not.toBeNull();
      expect(typeof rocks?.surface).toBe('string');
    }
  });
});

describe('tfc-1.20 rock: id validity', () => {
  it('every rock id named in the rockLayers tree is a real datapack rock id (src/data/tfc-1.20/rocks.json)', () => {
    // Guards the checks below against a hollow pass: if rocks.json were empty or stale, every
    // "id is known" assertion would trivially fail loudly instead of trivially passing.
    expect(KNOWN_ROCK_IDS.size).toBeGreaterThan(0);
    const inTree = rockIdsInTree();
    expect(inTree.size).toBeGreaterThan(0);
    for (const id of inTree) {
      expect(KNOWN_ROCK_IDS.has(id)).toBe(true);
    }
  });

  it("layer-settings.ts's own knownRockIds() (its source of truth) matches the datapack rocks map", () => {
    for (const id of knownRockIds()) {
      expect(KNOWN_ROCK_IDS.has(id)).toBe(true);
    }
  });

  it('every rock id the generator returns across many seeds and positions is a real datapack rock id', () => {
    const wideSeeds = [0n, 1n, -1n, 7n, 42n, 123456789n, -987654321n, 2n ** 62n, -(2n ** 62n)];
    const step = 733; // an odd stride, so sampled positions don't all land on the same block parity
    let sampled = 0;
    for (const seed of wideSeeds) {
      const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
      for (let i = -6; i <= 6; i++) {
        const x = i * step * 97;
        const z = i * step * 53;
        const rocks = generator.rocks(x, z);
        expect(rocks).not.toBeNull();
        for (const id of [rocks?.top, rocks?.middle, rocks?.bottom]) {
          expect(typeof id).toBe('string');
          expect(KNOWN_ROCK_IDS.has(id as string)).toBe(true);
        }
        sampled++;
      }
    }
    expect(sampled).toBeGreaterThan(50);
  });

  it('every id the rock palette covers is itself a real datapack rock id (no stale/typoed keys)', () => {
    for (const id of Object.keys(paletteData.colors)) {
      expect(KNOWN_ROCK_IDS.has(id)).toBe(true);
    }
  });

  it('the rock palette covers every id RockLayerSettings can produce (no missing colour falls back to a hash)', () => {
    for (const id of knownRockIds()) {
      expect(paletteData.colors[id]).toBeTypeOf('number');
    }
  });
});
