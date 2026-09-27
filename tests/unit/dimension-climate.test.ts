import { describe, expect, it } from 'vitest';
import { ClimateSearch, type ClimateTarget } from '@worldgen/vanilla/climate';
import {
  DimensionBiomeSampler,
  type DimensionClimateData,
} from '@worldgen/vanilla/dimension-biomes';
import beneath from '@data/tfg/dimensions/beneath.json';
import moon from '@data/tfg/dimensions/moon.json';
import mars from '@data/tfg/dimensions/mars.json';
import venus from '@data/tfg/dimensions/venus.json';
import glacio from '@data/tfg/dimensions/glacio.json';

/**
 * `tools/extract-dimension-climate.mjs` writes a router entry as 0 instead of inlining it when every
 * biome claims the same interval on that axis: the axis then adds the same distance to every biome,
 * so it cannot change which one the search picks. These tests hold the shipped files to that rule,
 * check its premise against the real search, and keep its licence consequence visible — the rule is
 * why no Ad Astra function ships (NOTICE.md section 6).
 */
interface ShippedDimension extends DimensionClimateData {
  readonly _meta: {
    readonly constant_router_entries: readonly string[];
    readonly density_functions: readonly string[];
  };
}

const DIMENSIONS = { beneath, moon, mars, venus, glacio } as unknown as Record<
  string,
  ShippedDimension
>;

/** Each router entry and the biome parameter it is measured against, in `ClimateTarget` order. */
const AXES = [
  ['temperature', 'temperature'],
  ['vegetation', 'humidity'],
  ['continents', 'continentalness'],
  ['erosion', 'erosion'],
  ['depth', 'depth'],
  ['ridges', 'weirdness'],
] as const;

function claim(value: number | readonly number[] | undefined): string {
  if (value === undefined) throw new Error('a biome without this climate parameter');
  return typeof value === 'number' ? `${value}..${value}` : `${value[0]}..${value[1]}`;
}

function claimedAlike(data: ShippedDimension, parameter: string): boolean {
  return new Set(data.biomes.map((entry) => claim(entry.parameters[parameter]))).size === 1;
}

function withAxis(target: ClimateTarget, axis: number, value: number): ClimateTarget {
  const t = [...target];
  t[axis] = value;
  return [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!];
}

describe('dimension climate routers', () => {
  for (const [name, data] of Object.entries(DIMENSIONS)) {
    it(`${name}: writes an entry as 0 exactly when every biome claims the same interval`, () => {
      for (const [entry, parameter] of AXES) {
        const alike = claimedAlike(data, parameter);
        expect(data.router[entry] === 0, entry).toBe(alike);
        expect(data._meta.constant_router_entries.includes(entry), entry).toBe(alike);
      }
    });
  }

  it('never lets an axis the biomes claim alike change which biome wins', () => {
    let checked = 0;
    for (const data of Object.values(DIMENSIONS)) {
      const alike = AXES.flatMap(([, parameter], axis) =>
        claimedAlike(data, parameter) ? [axis] : [],
      );
      if (alike.length === 0 || data.biomes.length < 2) continue;
      const sampler = new DimensionBiomeSampler(data, 20260926n);
      const search = new ClimateSearch(data.biomes);
      for (let x = -20000; x <= 20000; x += 1999) {
        for (let z = -20000; z <= 20000; z += 2003) {
          const target = sampler.target(x, data.seaLevel, z);
          const expected = search.find(target);
          for (const axis of alike) {
            // Quantized, so ±30 000 is ±3.0: past anything a climate noise returns.
            for (const value of [-30000, -10000, -1, 0, 1, 10000, 30000]) {
              expect(search.find(withAxis(target, axis, value))).toBe(expected);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('ships no Ad Astra density function or noise', () => {
    // A pack whose Moon biomes disagreed on depth would bring `ad_astra:depth` back, and that needs a
    // licence decision first: NOTICE.md section 6, tools/public-namespaces.json.
    for (const data of Object.values(DIMENSIONS)) {
      const fromAdAstra = [...data._meta.density_functions, ...Object.keys(data.noises)].filter(
        (id) => id.startsWith('ad_astra:'),
      );
      expect(fromAdAstra).toEqual([]);
    }
  });
});
