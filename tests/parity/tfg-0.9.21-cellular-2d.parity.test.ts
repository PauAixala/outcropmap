import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TFGCellular2D, type TFGCell } from '@worldgen/tfg/noise/tfg-cellular-2d';

interface Case {
  label: string;
  constructor: 'default' | 'sample-2' | 'custom' | 'explicit-zero';
  x: number;
  y: number;
  noise: number;
  cell: TFGCell;
}
interface Fixture { seed: string; cases: Case[] }

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/tfg-0.9.21-cellular-2d.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

function makeNoise(seed: bigint, kind: Case['constructor']): TFGCellular2D {
  if (kind === 'sample-2') return new TFGCellular2D(seed, 2);
  if (kind === 'custom') return new TFGCellular2D(42n, 0.25, 2).spread(0.125);
  if (kind === 'explicit-zero') return new TFGCellular2D(42n, 0, 1);
  return new TFGCellular2D(seed);
}

describe('TFG Core Modern 0.9.21 TFGCellular2D parity', () => {
  it('contains captured Java cases', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });
  for (const c of fixture.cases) {
    it(c.label, () => {
      const noise = makeNoise(BigInt(fixture.seed), c.constructor);
      const actual = noise.cell(c.x, c.y);
      expect(noise.noise(c.x, c.y)).toBe(c.noise);
      expect(actual).toEqual(c.cell);
    });
  }
});
