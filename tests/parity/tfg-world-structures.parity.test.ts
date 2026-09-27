/**
 * TerraFirmaGreg structure placement against a real saved world
 * (tests/fixtures/tfg-world-structures.json, read by tools/read-world-structures.py).
 *
 * Three claims, with three standards:
 * - placement: every real start is on the chunk `potentialStructureChunk` picks — exact;
 * - variant: where a start is predicted, the structure chosen matches the real one — exact;
 * - generation: over fully generated chunks only, predictions agree with the world — measured,
 *   not exact, because the biome and lithostitched checks are approximations (docs/PARITY.md).
 *   Measured 2026-09-11: 94 of 96 real starts found (recall 0.979), 3 false positives (precision
 *   0.969). The floors below catch a regression without pretending the approximation is exact.
 */
import '../../src/worldgen/profiles';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { potentialStructureChunk } from '../../src/worldgen/tfg/structures';
import type { TFGGenerator } from '../../src/worldgen/tfg';
import data from '../../src/data/tfg/structures.json';

interface Start {
  readonly structure: string;
  readonly chunkX: number;
  readonly chunkZ: number;
}
interface Fixture {
  readonly seed: string;
  readonly starts: readonly Start[];
  readonly coverage: Readonly<Record<string, string>>;
}
interface SetData {
  readonly id: string;
  readonly placement: { salt: number; spacing: number; separation: number; spreadType: string };
  readonly structures: readonly { id: string }[];
}

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tfg-world-structures.json'), 'utf8'),
) as Fixture;
const seed = BigInt(fixture.seed);
const sets = (data as unknown as { sets: SetData[] }).sets;
const setOf = new Map<string, SetData>();
for (const set of sets) for (const s of set.structures) setOf.set(s.id, set);

/** Whether the save holds a fully generated chunk here (the fixture's per-region bit maps). */
function fullyGenerated(chunkX: number, chunkZ: number): boolean {
  const hex = fixture.coverage[`${chunkX >> 5}.${chunkZ >> 5}`];
  if (!hex) return false;
  const bit = (chunkX & 31) + 32 * (chunkZ & 31);
  return ((parseInt(hex[255 - Math.floor(bit / 4)] ?? '0', 16) >> bit % 4) & 1) === 1;
}

describe('TFG 0.9.21 structures in a real saved world', () => {
  it('knows the set of every structure the save contains', () => {
    expect(fixture.starts.length).toBe(145);
    expect(fixture.starts.filter((s) => !setOf.has(s.structure))).toEqual([]);
  });

  it('places every real start on the chunk RandomSpreadStructurePlacement picks', () => {
    const misplaced = fixture.starts.filter((s) => {
      const set = setOf.get(s.structure)!;
      const [x, z] = potentialStructureChunk(seed, set.placement, s.chunkX, s.chunkZ);
      return x !== s.chunkX || z !== s.chunkZ;
    });
    expect(misplaced).toEqual([]);
  });

  it('agrees with the world on which chunks start a structure, and which one', () => {
    const generator = createGenerator('tfg', { seed, dimension: 'overworld' }) as unknown as TFGGenerator;
    const real = new Map<string, string>();
    for (const s of fixture.starts) {
      if (fullyGenerated(s.chunkX, s.chunkZ)) real.set(`${setOf.get(s.structure)!.id}@${s.chunkX},${s.chunkZ}`, s.structure);
    }

    let truePositives = 0;
    let falsePositives = 0;
    const wrongVariant: string[] = [];
    const found = new Set<string>();
    for (const region of Object.keys(fixture.coverage)) {
      const [rx, rz] = region.split('.').map(Number) as [number, number];
      const box = { minX: rx * 512, minZ: rz * 512, maxX: rx * 512 + 511, maxZ: rz * 512 + 511 };
      for (const feature of generator.structures(box)) {
        const [, position] = feature.id.split('@') as [string, string];
        const [chunkX, chunkZ] = position.split(',').map(Number) as [number, number];
        if (!fullyGenerated(chunkX, chunkZ)) continue;
        const structure = real.get(feature.id);
        if (structure === undefined) {
          falsePositives++;
          continue;
        }
        truePositives++;
        found.add(feature.id);
        if (structure !== feature.type) wrongVariant.push(`${feature.id}: ${feature.type} vs ${structure}`);
      }
    }

    expect(real.size).toBe(96);
    expect(wrongVariant).toEqual([]);
    expect(truePositives / real.size).toBeGreaterThanOrEqual(0.95);
    expect(truePositives / (truePositives + falsePositives)).toBeGreaterThanOrEqual(0.95);
  }, 120_000);
});
