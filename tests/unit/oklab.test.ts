import { describe, expect, it } from 'vitest';
import {
  linearRgbToOklab,
  linearRgbToPacked,
  linearToSrgb,
  MACHADO_2009,
  oklabDistance,
  oklabToLinearRgb,
  packedToLinearRgb,
  packedToOklab,
  simulateCvd,
  srgbToLinear,
  type CvdKind,
} from '@core/color';

describe('OKLab (Ottosson 2020)', () => {
  // Reference values for the sRGB primaries, as published with OKLab and used by CSS Color 4.
  const primaries: readonly [string, number, readonly [number, number, number]][] = [
    ['red', 0xff0000, [0.627955, 0.224863, 0.125846]],
    ['green', 0x00ff00, [0.86644, -0.233888, 0.179498]],
    ['blue', 0x0000ff, [0.452014, -0.032457, -0.311528]],
  ];

  it.each(primaries)('converts sRGB %s to its published OKLab value', (_name, packed, expected) => {
    const lab = packedToOklab(packed);
    expect(lab.L).toBeCloseTo(expected[0], 4);
    expect(lab.a).toBeCloseTo(expected[1], 4);
    expect(lab.b).toBeCloseTo(expected[2], 4);
  });

  it('puts white at L 1 and black at L 0, both on the neutral axis', () => {
    const white = packedToOklab(0xffffff);
    expect(white.L).toBeCloseTo(1, 5);
    expect(white.a).toBeCloseTo(0, 5);
    expect(white.b).toBeCloseTo(0, 5);
    expect(packedToOklab(0x000000)).toEqual({ L: 0, a: 0, b: 0 });
  });

  it('keeps every grey on the neutral axis', () => {
    for (let v = 0; v <= 255; v += 15) {
      const lab = packedToOklab((v << 16) | (v << 8) | v);
      expect(Math.abs(lab.a)).toBeLessThan(1e-6);
      expect(Math.abs(lab.b)).toBeLessThan(1e-6);
    }
  });

  it('round-trips through linear sRGB', () => {
    for (const packed of [0x123456, 0xc8692c, 0xe6b422, 0x2e9e5e, 0x7a50a8, 0xf4f0e8]) {
      const rgb = packedToLinearRgb(packed);
      const lab = linearRgbToOklab(rgb.r, rgb.g, rgb.b);
      const back = oklabToLinearRgb(lab.L, lab.a, lab.b);
      expect(back.r).toBeCloseTo(rgb.r, 6);
      expect(back.g).toBeCloseTo(rgb.g, 6);
      expect(back.b).toBeCloseTo(rgb.b, 6);
      expect(linearRgbToPacked(back.r, back.g, back.b)).toBe(packed);
    }
  });

  it('applies the sRGB transfer function both ways', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214041, 5);
    expect(linearToSrgb(0.214041)).toBeCloseTo(0.5, 5);
    // The linear segment near black.
    expect(srgbToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 10);
  });

  it('measures distance as Euclidean ΔE_OK', () => {
    expect(oklabDistance({ L: 0.5, a: 0, b: 0 }, { L: 0.5, a: 0.03, b: 0.04 })).toBeCloseTo(0.05, 12);
    expect(oklabDistance(packedToOklab(0x000000), packedToOklab(0xffffff))).toBeCloseTo(1, 5);
  });

  it('writes into a caller-supplied object instead of allocating', () => {
    const out = { L: 0, a: 0, b: 0 };
    expect(packedToOklab(0xff0000, out)).toBe(out);
    const rgb = { r: 0, g: 0, b: 0 };
    expect(oklabToLinearRgb(0.5, 0, 0, rgb)).toBe(rgb);
  });
});

describe('CVD simulation (Machado, Oliveira and Fernandes 2009)', () => {
  const kinds: readonly CvdKind[] = ['protanopia', 'deuteranopia', 'tritanopia'];

  it.each(kinds)('%s leaves white and every grey unchanged', (kind) => {
    // Each row of the paper's matrices sums to 1, so the neutral axis is preserved.
    const m = MACHADO_2009[kind];
    for (let row = 0; row < 3; row++) {
      expect(m[row * 3]! + m[row * 3 + 1]! + m[row * 3 + 2]!).toBeCloseTo(1, 5);
    }
    for (const v of [0, 0.18, 0.5, 1]) {
      const out = simulateCvd(kind, v, v, v);
      expect(out.r).toBeCloseTo(v, 5);
      expect(out.g).toBeCloseTo(v, 5);
      expect(out.b).toBeCloseTo(v, 5);
    }
  });

  it('maps linear red to the first column of the severity-1.0 matrix, clamped', () => {
    expect(simulateCvd('deuteranopia', 1, 0, 0)).toEqual({ r: 0.367322, g: 0.280085, b: 0 });
    expect(simulateCvd('protanopia', 1, 0, 0)).toEqual({ r: 0.152286, g: 0.114503, b: 0 });
  });

  it('collapses the red-green axis for protanopia and deuteranopia, not for tritanopia', () => {
    const look = (kind: CvdKind | null, packed: number) => {
      const rgb = packedToLinearRgb(packed);
      const seen = kind === null ? rgb : simulateCvd(kind, rgb.r, rgb.g, rgb.b);
      return linearRgbToOklab(seen.r, seen.g, seen.b);
    };
    // A red and a green that both red-green dichromats confuse: far apart normally, about a
    // quarter of that distance for them, and still far apart for tritanopia (blue-yellow).
    const red = 0xd04a3a;
    const green = 0x488038;
    const normal = oklabDistance(look(null, red), look(null, green));
    expect(normal).toBeGreaterThan(0.15);
    expect(oklabDistance(look('protanopia', red), look('protanopia', green))).toBeLessThan(normal / 3);
    expect(oklabDistance(look('deuteranopia', red), look('deuteranopia', green))).toBeLessThan(normal / 3);
    expect(oklabDistance(look('tritanopia', red), look('tritanopia', green))).toBeGreaterThan(normal / 2);
  });
});
