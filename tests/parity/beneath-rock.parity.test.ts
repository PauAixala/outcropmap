import { describe, expect, it } from 'vitest';
import { BeneathGenerator, BENEATH_SURFACE_Y } from '@worldgen/tfg/beneath';
import fixture from '../fixtures/tfg/beneath-rock.json';

/**
 * The Beneath's rock, against the rock a real Beneath contains.
 *
 * The fixture is deliberately the **deep** volume — 120 or more blocks below the roof at y 208 —
 * because that is where TerraFirmaGreg's chunk generator is the only author. Nearer the roof the
 * Beneath mod's own features replace rock the generator laid, and comparing there measures the
 * features we have not ported rather than the port under test: 90.9% over the whole column against
 * 97.8% here, on the same world.
 *
 * Captured from Pau's save (seed −6696614430994881185) after generating 36 regions with Chunky.
 * Reproduce with the recipe in docs/WORLDGEN-NOTES.md.
 */
describe('the Beneath, against a real one', () => {
  const data = fixture as unknown as {
    _meta: { blocks: number; columns: number };
    columns: { x: number; z: number; rock: Record<string, string> }[];
  };
  const beneath = new BeneathGenerator();

  it('has a fixture worth checking against', () => {
    expect(data.columns.length).toBeGreaterThan(30);
    expect(data._meta.blocks).toBeGreaterThan(1500);
  });

  it('names the right rock at least 95% of the time where nothing decorates', () => {
    let total = 0;
    let correct = 0;
    for (const column of data.columns) {
      for (const [y, truth] of Object.entries(column.rock)) {
        // The fixture must stay in the undecorated volume, or this stops measuring the port.
        expect(BENEATH_SURFACE_Y - Number(y)).toBeGreaterThanOrEqual(120);
        total++;
        if (beneath.rockAt(column.x, Number(y), column.z) === truth) correct++;
      }
    }
    const accuracy = correct / total;
    // Measured at 97.8% over 9 124 blocks; the floor leaves room for a fixture reshuffle but would
    // catch a real regression in the layer walk or the y/6 skew.
    expect(accuracy, `${(100 * accuracy).toFixed(2)}% of ${total}`).toBeGreaterThan(0.95);
  });
});
