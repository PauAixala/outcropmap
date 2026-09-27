import { describe, expect, it } from 'vitest';
import { columnCanHost, hostRockIdsOf } from '../../src/worldgen/tfc-1.20/features/vein-materials';
import { clusterVeinsFor } from '../../src/worldgen/tfc-1.20/features/cluster-vein';

/**
 * A vein only writes a block where its replacement table has an entry for the rock already there,
 * and the rock changes with depth. Pau dug to three markers in his own world and came back empty;
 * reading the save afterwards showed why in each case:
 *
 * - 1658,3735: the column holds slate and gneiss, which `normal_gold` can replace — but only far
 *   below the vein. Every ore block in the vein's own band (y 34..54) is `conglomerate_*`.
 * - -2628,3363: same shape, with `surface_gold` over sandstone and claystone.
 *
 * So the check is per Y band, not per column.
 */
describe('host rock gate', () => {
  /** A world where the top 20 blocks are conglomerate and everything below is slate. */
  const layered = (_x: number, y: number, _z: number): string => (y > 40 ? 'conglomerate' : 'slate');

  it('reads the rocks a vein can replace out of its own table', () => {
    const rocks = hostRockIdsOf({
      'tfc:rock/raw/granite': [{ block: 'x' }],
      'minecraft:tuff': [{ block: 'y' }],
    });
    expect([...rocks].sort()).toEqual(['granite', 'tuff']);
  });

  it('keeps a vein whose band is in rock it can replace', () => {
    // Slate-hosted vein sitting at y 20..35: entirely in slate.
    expect(columnCanHost(new Set(['slate']), 0, 0, 20, 35, layered)).toBe(true);
  });

  it('drops a vein whose band is in rock it cannot replace', () => {
    // The same vein at y 45..60 is entirely in conglomerate — the 1658,3735 case.
    expect(columnCanHost(new Set(['slate']), 0, 0, 45, 60, layered)).toBe(false);
  });

  it('follows the middle of the band when the vein straddles a boundary', () => {
    // y 30..55 has its middle at 42, in conglomerate: the mass of the body is in rock the vein
    // cannot replace, so it goes. Measured, not assumed -- see `columnCanHost`.
    expect(columnCanHost(new Set(['slate']), 0, 0, 30, 55, layered)).toBe(false);
    // y 20..50 has its middle at 35, in slate: it stays.
    expect(columnCanHost(new Set(['slate']), 0, 0, 20, 50, layered)).toBe(true);
  });

  it('never hides a vein when the answer is unknown, or when the vein has no table', () => {
    expect(columnCanHost(new Set(['basalt']), 0, 0, 0, 20, undefined)).toBe(true);
    expect(columnCanHost(new Set(['basalt']), 0, 0, 0, 20, () => null)).toBe(true);
    expect(columnCanHost(new Set(), 0, 0, 0, 20, () => 'slate')).toBe(true);
  });

  it('asks the own column of the marker, not a ring around it', () => {
    // The ring is what let two `deep_galena` markers through in Pau's world: one match 24 blocks
    // away kept a vein whose own column could not host it. Measured, the ring cost 6 points of
    // precision -- see `columnCanHost`.
    const patchy = (x: number): string => (x === 15 ? 'basalt' : 'slate');
    expect(columnCanHost(new Set(['basalt']), 0, 0, 0, 20, patchy)).toBe(false);
    expect(columnCanHost(new Set(['basalt']), 15, 0, 0, 20, patchy)).toBe(true);
  });

  it('knows which rocks the gold vein Pau dug to needs', () => {
    const surfaceGold = clusterVeinsFor('tfg').find((v) => v.id === 'surface_gold');
    expect(surfaceGold, 'surface_gold is in the TFG table').toBeDefined();
    expect([...surfaceGold!.hostRockIds].sort()).toEqual(['andesite', 'basalt', 'dacite', 'rhyolite']);
    // Sandstone and claystone, which is what the save holds there: nothing to replace.
    const shore = (): string => 'claystone';
    expect(columnCanHost(surfaceGold!.hostRockIds, -2628, 3363, 39, 69, shore)).toBe(false);
  });
});
