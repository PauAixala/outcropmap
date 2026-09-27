/**
 * Parity test: the TS port's seeding and placement primitives against golden values captured
 * straight from the real, unmodified TFC Java method bodies (`VeinFeature#getVeinsAtChunk`/
 * `#defaultYPos`, `DiscVeinFeature#createVein`/`#defaultPosRespectingHeight` -- verbatim-extracted
 * and run under a JDK, see `tools/parity/capture-tfc-veins.mjs`'s header for exactly how and why
 * `VeinConfig`/`DiscVeinConfig` themselves could not be compiled unmodified in this environment).
 *
 * The fixture's harness stubs `canSpawnAt` (the biome-tag restriction) to always succeed and never
 * draws from `random` for it -- biome restriction has no RNG in the real source either (see
 * `src/worldgen/tfc-1.20/features/biome-tags.ts`'s header), so this test exercises the seeding
 * formula, the rarity gate and `defaultYPos`/`defaultPosRespectingHeight` directly through the same
 * exported primitives `disc-vein.ts` composes into `findDiscVeinInChunk`, without going through the
 * biome check itself.
 *
 * Never adjust a fixture to match the port -- a mismatch here means the port is wrong.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkVeinRandom, discVeinPosition, veinNameSeed } from '../../src/worldgen/tfc-1.20/features/disc-vein';
import type { DiscVeinDef } from '../../src/worldgen/tfc-1.20/features/disc-vein';

interface VeinFixtureCase {
  readonly worldSeed: string;
  readonly randomName: string;
  readonly rarity: number;
  readonly minY: number;
  readonly maxY: number;
  readonly size: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly veinNameSeed: string;
  readonly spawned: boolean;
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/tfc-1.20/veins.json',
);
const fixture: { readonly source: string; readonly cases: readonly VeinFixtureCase[] } = JSON.parse(
  readFileSync(fixturePath, 'utf8'),
);

/** Builds a minimal `DiscVeinDef` for `discVeinPosition`, which only reads `size`/`minY`/`maxY` --
 * every other field is set to an inert placeholder since this test never inspects them. */
function fakeVein(c: VeinFixtureCase): DiscVeinDef {
  return {
    id: c.randomName,
    ore: `tfc:${c.randomName}`,
    kind: 'mineral',
    rarity: c.rarity,
    minY: c.minY,
    maxY: c.maxY,
    size: c.size,
    height: 0,
    density: 1,
    hasIndicator: false,
  indicator: null,
  project: false,
  projectOffset: false,
    biomeTag: null,
    hostRock: '',
    hostRockIds: new Set<string>(),
    nameSeed: 0n,
    produces: [],
  };
}

describe('tfc-1.20 disc veins: parity against the real Java method bodies', () => {
  it(`has a non-empty fixture (${fixture.cases.length} cases) captured from ${fixture.source.slice(0, 40)}...`, () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    const label = `${c.randomName} @ seed ${c.worldSeed}, chunk (${c.chunkX}, ${c.chunkZ})`;

    it(`${label}: VeinConfig#hash(random_name) matches`, () => {
      expect(veinNameSeed(c.randomName).toString()).toBe(c.veinNameSeed);
    });

    it(`${label}: rarity gate and, when it spawns, defaultPosRespectingHeight match`, () => {
      const worldSeed = BigInt(c.worldSeed);
      const nameSeed = veinNameSeed(c.randomName);
      expect(nameSeed.toString()).toBe(c.veinNameSeed);

      const random = chunkVeinRandom(worldSeed, nameSeed, c.chunkX, c.chunkZ);
      const spawned = random.nextInt(c.rarity) === 0;
      expect(spawned).toBe(c.spawned);

      if (spawned) {
        const pos = discVeinPosition(random, c.chunkX << 4, c.chunkZ << 4, fakeVein(c));
        expect(pos.x).toBe(c.x);
        expect(pos.y).toBe(c.y);
        expect(pos.z).toBe(c.z);
      }
    });
  }
});
