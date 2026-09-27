import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '@worldgen/registry';
import { unevaluatedExclusions } from '@worldgen/tfg/structures';
import fixture from '../fixtures/tfg/dimension-structures.json';

/**
 * Structures in the Beneath and on the Moon, against a real save — and unlike the overworld's, these
 * are **exact**, both ways.
 *
 * | | Real starts | Found | False positives |
 * | --- | --- | --- | --- |
 * | The Beneath (`tfg:beneath/tower`) | 17 | 17 | 0 |
 * | The Moon (four sets) | 494 | 494 | 0 |
 *
 * The overworld's structures are an approximation (0.979 recall / 0.969 precision) because their
 * generation depends on climate, forest type and an approximate surface height. None of those five
 * sets has a climate placement or a lithostitched condition: they are plain `random_spread` with a
 * biome list, and the biome is now exact in both dimensions. So there is nothing left to approximate.
 *
 * Three things had to be right at once, and each was silently wrong first:
 *
 * 1. The biome tags are built by a **KubeJS loop** over `global.MOON_BIOMES`, not by a JSON file, so
 *    a regex over `event.add('tag', 'biome')` literals found nothing and every list came out empty —
 *    which on a map reads as "generates in every biome".
 * 2. The extractor filtered biome ids against the **overworld's** 109, so even a resolved Moon tag
 *    was emptied again.
 * 3. `exclusionZone` was extracted and never ported. No overworld set uses one; three of the Moon's
 *    four do, and the Beneath tower's names vanilla's `minecraft:nether_complexes` — which really
 *    does stand in its way, and was 2 false positives in 19 until its placement was carried too.
 */
describe('structures in the other dimensions, against a real world', () => {
  const data = fixture as unknown as Record<
    string,
    {
      seed: string;
      starts: { structure: string; chunkX: number; chunkZ: number }[];
      coverage: Record<string, string>;
    }
  >;

  /** The chunks the save actually generated; anything outside them is unverifiable, not wrong. */
  function fullChunks(coverage: Record<string, string>): Set<string> {
    const out = new Set<string>();
    for (const [key, hex] of Object.entries(coverage)) {
      const parts = key.split('.');
      const rx = Number(parts[0]);
      const rz = Number(parts[1]);
      const bits = BigInt(`0x${hex}`);
      for (let i = 0; i < 1024; i++) {
        if ((bits >> BigInt(i)) & 1n) out.add(`${rx * 32 + (i % 32)},${rz * 32 + Math.floor(i / 32)}`);
      }
    }
    return out;
  }

  for (const [dimension, world] of Object.entries(data)) {
    it(`matches every start in ${dimension}`, () => {
      const full = fullChunks(world.coverage);
      const chunks = [...full].map((key) => key.split(',').map(Number) as [number, number]);
      const box = {
        minX: Math.min(...chunks.map((c) => c[0])) * 16,
        maxX: Math.max(...chunks.map((c) => c[0])) * 16 + 15,
        minZ: Math.min(...chunks.map((c) => c[1])) * 16,
        maxZ: Math.max(...chunks.map((c) => c[1])) * 16 + 15,
      };
      const generator = createGenerator('tfg', {
        seed: BigInt(world.seed),
        dimension: dimension as 'nether' | 'moon',
      });
      const predicted = new Set(
        generator
          .features(box, ['structures'])
          .structures.map((f) => ({ type: f.type, key: `${Math.floor(f.x / 16)},${Math.floor(f.z / 16)}` }))
          .filter((p) => full.has(p.key))
          .map((p) => `${p.type}@${p.key}`),
      );
      const real = new Set(
        world.starts
          .map((s) => ({ key: `${s.chunkX},${s.chunkZ}`, structure: s.structure }))
          .filter((s) => full.has(s.key))
          .map((s) => `${s.structure}@${s.key}`),
      );

      expect(real.size).toBeGreaterThan(10);
      expect([...real].filter((k) => !predicted.has(k))).toEqual([]);
      expect([...predicted].filter((k) => !real.has(k))).toEqual([]);
    });
  }

  it('leaves no exclusion zone unevaluated', () => {
    // A zone this port cannot compute lets the set through, so a marker appears where the game puts
    // nothing. Empty here means every zone in play was actually checked.
    expect([...unevaluatedExclusions]).toEqual([]);
  });
});
