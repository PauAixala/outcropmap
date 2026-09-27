import { describe, expect, it } from 'vitest';
import '@worldgen/profiles';
import { createGenerator, listProfiles } from '@worldgen/registry';
import { BENEATH_SURFACE_Y } from '@worldgen/tfg/beneath';

/** The Beneath as the map sees it: a real generator for the dimension, honest about its gaps. */
describe('the Beneath on the map', () => {
  const seed = -6696614430994881185n;

  it('is offered by the TFG profile', () => {
    const tfg = listProfiles().find((p) => p.id === 'tfg');
    expect(tfg?.dimensions).toContain('nether');
  });

  it('the registry hands back the Beneath generator for that dimension', () => {
    const beneath = createGenerator('tfg', { seed, dimension: 'nether' });
    const overworld = createGenerator('tfg', { seed, dimension: 'overworld' });
    expect(beneath.dimension).toBe('nether');
    expect(beneath.constructor).not.toBe(overworld.constructor);
  });

  it('answers rock and height, and says null where it does not know', () => {
    const gen = createGenerator('tfg', { seed, dimension: 'nether' });
    expect(gen.surfaceY(120, -340)).toBe(BENEATH_SURFACE_Y);
    const rocks = gen.rocks(120, -340);
    expect(rocks?.top).toBeTruthy();
    expect(rocks?.bottom).toBeTruthy();
    // Biomes are modelled and exact (tests/parity/beneath-biome.parity.test.ts); veins are not,
    // and an empty answer is the true one.
    expect(gen.biome(120, -340)).toMatch(/^tfg:nether\//);
    // 29 veins, all of them biome-gated and none excluded -- measured at 94.3% against the real
    // Beneath (docs/PARITY.md), so an empty box here would mean the wiring is broken.
    const deposits = gen.features({ minX: 0, minZ: 0, maxX: 511, maxZ: 511 }).deposits;
    expect(deposits.length).toBeGreaterThan(100);
    expect(new Set(deposits.map((d) => d.ore)).size).toBeGreaterThan(10);
  });

  it('reports the flat climate rather than an invented one', () => {
    const probe = createGenerator('tfg', { seed, dimension: 'nether' }).probe(64, 64);
    expect(probe.climate).toEqual({ temperature: 0, rainfall: 0 });
    expect(probe.surfaceY).toBe(BENEATH_SURFACE_Y);
    expect(probe.biome).toMatch(/^tfg:nether\//);
  });

  it('is the same whatever the seed, because the pack built it from literals', () => {
    const a = createGenerator('tfg', { seed: 1n, dimension: 'nether' });
    const b = createGenerator('tfg', { seed: -999n, dimension: 'nether' });
    expect(b.rocks(500, -1200)).toEqual(a.rocks(500, -1200));
  });
});
