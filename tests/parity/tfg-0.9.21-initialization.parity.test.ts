import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/tfg-0.9.21-initialization.json';
import { TFGRegion, initializeRegion, addContinents } from '@worldgen/tfg/region/initialization';
import type { Cell } from '@worldgen/tfc-1.20/noise/cellular-2d';

describe('TFG 0.9.21 INIT and ADD_CONTINENTS (original Java tasks, synthetic inputs)', () => {
  it('has version-pinned cases including the strict continent threshold', () => {
    expect(fixture.tfgRevision).toBe('2cf74e65114417b7466fe80910993d0483e0a65f');
    expect(fixture.cases.length).toBe(3);
    const values = fixture.cases.flatMap(c => c.points.map(p => p[3] as number));
    expect(values.some(v => v === 4.4)).toBe(true);
    expect(values.some(v => v > 4.4)).toBe(true);
    expect(values.some(v => v < 4.4)).toBe(true);
  });

  for (const c of fixture.cases) {
    it(`matches bounds, holes, mixin fields, point indices and land flags: ${c.name}`, () => {
      const cell: Cell = { x: c.center[0]!, y: c.center[1]!, cx: 0, cy: 0, f1: 0, f2: 0, noise: 0 };
      const region = new TFGRegion(cell);
      const owned = new Set(c.owned.map(([x, z]) => `${x},${z}`));
      initializeRegion(region, cell, (x, z) => owned.has(`${x},${z}`)
        ? { ...cell, cx: 99, cy: 99 }
        : { ...cell, x: cell.x + 1 });
      expect([region.minX, region.minZ, region.maxX, region.maxZ]).toEqual(c.bounds);
      expect(region.data.length).toBe(region.sizeX * region.sizeZ);
      const points = region.data.filter(p => p !== undefined);
      expect(points.map(p => [p.x, p.z, p.index, p.land(), p.distanceToWestCoast, p.hotSpotAge, p.isSurfaceRockKarst])).toEqual(c.initialized);
      expect(points.length).toBe(owned.size);
      for (const p of points) expect(region.data[p.index]).toBe(p);

      const noiseValues = new Map(c.points.map(p => [`${p[0]},${p[1]}`, p[3] as number]));
      const calls: string[] = [];
      addContinents(region, (x, z) => {
        calls.push(`${x},${z}`);
        return noiseValues.get(`${x},${z}`)!;
      });
      expect(calls).toEqual(c.points.map(p => `${p[0]},${p[1]}`));
      expect(points.map(p => [p.x, p.z, p.index, noiseValues.get(`${p.x},${p.z}`), p.land()])).toEqual(c.points);
    });
  }
});
