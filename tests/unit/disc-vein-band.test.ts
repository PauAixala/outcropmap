import { describe, expect, it } from 'vitest';
import type { RandomSource } from '../../src/core/random';
import {
  defaultYPos,
  discVeinBand,
  discVeinsFor,
  findDiscVeinInChunk,
} from '../../src/worldgen/tfc-1.20/features/disc-vein';
import type { VeinProfileId } from '../../src/worldgen/tfc-1.20/features/vein-tables';
import { KAOLIN } from '../../src/worldgen/tfg/kaolin';
import { discVeinBand as siteDiscVeinBand } from '../../src/app/site/facts';

/**
 * `discVeinBand`: the heights a disc vein's blocks can take, which is what the ore filter shows.
 * The centre comes from `VeinFeature#defaultYPos(size, ...)`, the disc reaches `height` either side
 * of it (`DiscVeinFeature#getChanceToGenerate`), and `VeinFeature#place` clips the Y loop to the
 * vein's `[min_y, max_y]`.
 */

/** A source whose bounded draw is always `value`: `defaultYPos` draws once, `nextInt(range)`. */
const drawing = (value: number): RandomSource => ({
  next: () => 0,
  nextInt: () => value,
  nextLong: () => 0n,
  nextBoolean: () => false,
  nextFloat: () => 0,
  nextDouble: () => 0,
  nextGaussian: () => 0,
});

/** The band by brute force: every centre `defaultYPos` can return, every height the disc fills. */
function bruteBand(vein: { minY: number; maxY: number; size: number; height: number }): {
  minY: number;
  maxY: number;
} {
  const range = vein.maxY - vein.minY - 2 * vein.size;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let draw = 0; draw < Math.max(range, 1); draw++) {
    const centre = defaultYPos(vein.size, drawing(draw), vein.minY, vein.maxY);
    for (let y = centre - vein.height; y <= centre + vein.height; y++) {
      if (y < vein.minY || y > vein.maxY) continue;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minY, maxY };
}

const SETS: readonly VeinProfileId[] = [
  'tfc-1.20',
  'tfg',
  'tfg-nether',
  'tfg-moon',
  'tfg-mars',
  'tfg-venus',
];

describe('disc vein band', () => {
  it('puts every kaolin patch in Y 86 to 98, in both profiles', () => {
    // 110 - 75 - 2 * 18 < 0, so defaultYPos always returns (75 + 110) / 2 = 92.
    const tfc = discVeinsFor('tfc-1.20').find((vein) => vein.id === 'kaolin_disc');
    expect(tfc).toBeDefined();
    expect(discVeinBand(tfc!)).toEqual({ minY: 86, maxY: 98 });
    expect(discVeinBand(KAOLIN)).toEqual({ minY: 86, maxY: 98 });
  });

  it('is every height the port can put a disc block at, for every disc of every table', () => {
    let checked = 0;
    for (const set of SETS) {
      for (const vein of discVeinsFor(set)) {
        expect([set, vein.id, discVeinBand(vein)]).toEqual([set, vein.id, bruteBand(vein)]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('spans the centre’s whole range when the window is wide enough to draw one', () => {
    // TerraFirmaGreg's normal_copper: Y 10..70, size 30, height 10 -> 70 - 10 - 60 = 0, so the
    // centre is always 40; normal_gold (size 24) draws it from 34..45.
    const copper = discVeinsFor('tfg').find((vein) => vein.id === 'normal_copper');
    const gold = discVeinsFor('tfg').find((vein) => vein.id === 'normal_gold');
    expect(discVeinBand(copper!)).toEqual({ minY: 30, maxY: 50 });
    expect(discVeinBand(gold!)).toEqual({ minY: 24, maxY: 55 });
  });

  it('clips to the vein’s own window, as VeinFeature#place does', () => {
    // TerraFirmaGreg's deep_sulfur (near_lava, so not on the map): Y -60..-45, size 35, height 10.
    // The centre is always -52, and -62..-42 is cut back to the window.
    expect(discVeinBand({ minY: -60, maxY: -45, size: 35, height: 10 })).toEqual({
      minY: -60,
      maxY: -45,
    });
  });

  it('holds every disc the map places, as the probe reports it', () => {
    const anywhere = (): string => 'anywhere';
    const everyBiome = (): ReadonlySet<string> => new Set(['anywhere']);
    let found = 0;
    for (const set of SETS) {
      // Surface-relative discs are placed on a surface height; their band is from the surface.
      for (const vein of discVeinsFor(set).filter((candidate) => !candidate.project)) {
        const band = discVeinBand(vein);
        for (let cz = -24; cz < 24; cz++) {
          for (let cx = -24; cx < 24; cx++) {
            const deposit = findDiscVeinInChunk(42n, vein, cx, cz, anywhere, everyBiome);
            if (deposit === null) continue;
            found++;
            expect([vein.id, deposit.bottomY >= band.minY && deposit.topY <= band.maxY]).toEqual([
              vein.id,
              true,
            ]);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(100);
  });

  it('agrees with the site’s copy, which the guides and the About page print', () => {
    // src/app/site/facts.ts keeps its own discVeinBand: build-time site code cannot import the port.
    let checked = 0;
    for (const set of SETS) {
      for (const vein of discVeinsFor(set)) {
        expect([set, vein.id, siteDiscVeinBand(vein)]).toEqual([set, vein.id, discVeinBand(vein)]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
