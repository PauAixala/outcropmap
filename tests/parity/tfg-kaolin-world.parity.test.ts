import { expect, it } from 'vitest';
import fixture from '../fixtures/tfg-world-kaolin.json';
import { TFGGenerator } from '../../src/worldgen/tfg';
import { KAOLIN } from '../../src/worldgen/tfg/kaolin';

it('retains candidate bounds covering the observed saved-world kaolin blocks', () => {
  const g = new TFGGenerator({ seed: -6696614430994881185n, dimension: 'overworld' });
  expect(fixture.chunks.length).toBeGreaterThan(40);
  const missing: unknown[] = [];
  for (const chunk of fixture.chunks) {
    const deposits = g.features({
      minX: chunk.chunkX * 16 - 32,
      minZ: chunk.chunkZ * 16 - 32,
      maxX: chunk.chunkX * 16 + 47,
      maxZ: chunk.chunkZ * 16 + 47,
    }).deposits;
    for (const block of chunk.blocks) {
      const [x, y, z] = block as [number, number, number];
      if (
        !deposits.some(
          (d) =>
            Math.abs(d.x - x) <= KAOLIN.size &&
            Math.abs(d.z - z) <= KAOLIN.size &&
            y >= d.bottomY &&
            y <= d.topY,
        )
      )
        missing.push(block);
    }
  }
  expect(missing).toEqual([]);
}, 60000);
