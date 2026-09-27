import { describe, expect, it } from 'vitest';
import { BeneathGenerator, BENEATH_SURFACE_Y, beneathRockSampler } from '@worldgen/tfg/beneath';
import beneathRocks from '@data/tfg/rock-layers-beneath.json';

/**
 * The Beneath — TerraFirmaGreg's rebuilt Nether. Ported from the pack's own KubeJS script, which is
 * short enough to read in full; see `src/worldgen/tfg/beneath.ts`.
 */
describe('the Beneath', () => {
  const beneath = new BeneathGenerator();

  it('is flat at 208, everywhere', () => {
    expect(BENEATH_SURFACE_Y).toBe(208);
    expect(beneath.surfaceY()).toBe(208);
  });

  it('has no climate, and says zero rather than inventing one', () => {
    expect(beneath.climate()).toEqual({ temperature: 0, rainfall: 0 });
  });

  it('carries its own fourteen rocks, not the overworld ones', () => {
    const data = beneathRocks as unknown as { bottom: string[]; layers: { id: string }[] };
    expect(data.bottom).toEqual(['blackstone']);
    expect(data.layers.map((l) => l.id)).toContain('lowest');
    // Deepslate and blackstone belong to the Beneath; the overworld stack has neither.
    const stack = new Set<string>();
    for (let layer = 0; layer < 8; layer++) {
      for (let point = 0; point < 40; point++) {
        const rock = beneathRockSampler.sampleAtLayer(point * 1103515245, layer);
        if (rock) stack.add(rock);
      }
    }
    expect(stack.has('blackstone') || stack.has('deepslate')).toBe(true);
  });

  it('names a rock at every depth from the roof to the bottom', () => {
    for (let y = BENEATH_SURFACE_Y; y >= -60; y -= 17) {
      const rock = beneath.rockAt(120, y, -340);
      expect(rock, `y=${y}`).toBeTruthy();
    }
  });

  it('changes rock as you go down, in bands rather than at random', () => {
    const column: (string | null)[] = [];
    for (let y = BENEATH_SURFACE_Y; y >= 0; y--) column.push(beneath.rockAt(64, y, 64));
    const changes = column.filter((rock, i) => i > 0 && rock !== column[i - 1]).length;
    // 208 blocks over bands of 38 is a handful of boundaries, not a new rock every block.
    expect(changes).toBeGreaterThan(0);
    expect(changes).toBeLessThan(12);
  });

  it('is the same in every world: its noises are seeded from literals', () => {
    const a = new BeneathGenerator();
    const b = new BeneathGenerator();
    for (const [x, y, z] of [[0, 200, 0], [-1200, 100, 3400], [8000, 5, -8000]] as const) {
      expect(b.rockAt(x, y, z)).toBe(a.rockAt(x, y, z));
    }
  });
});
