import { describe, expect, it } from 'vitest';
import { sampleHeightField } from '../../src/layers/height-field';
import { contourLayer, hillshadeLayer, terrainLayer } from '../../src/layers/raster-layers';
import type { WorldGenerator } from '../../src/worldgen/api/types';

/** A generator that is nothing but a height function — the only thing these tests exercise. */
function generatorWithHeight(surfaceY: (x: number, z: number) => number | null): WorldGenerator {
  return { surfaceY } as unknown as WorldGenerator;
}

const SIZE = 64;

describe('sampleHeightField', () => {
  it('reproduces a plane exactly, since bilinear interpolation is exact on one', () => {
    const field = sampleHeightField(
      generatorWithHeight((x, z) => 64 + 0.1 * x + 0.2 * z),
      1000,
      -500,
      SIZE,
      4,
    );
    expect(field.available).toBe(true);
    for (const [px, pz] of [
      [0, 0],
      [17, 3],
      [SIZE - 1, SIZE - 1],
    ] as const) {
      const expected = 64 + 0.1 * (1000 + px * 4) + 0.2 * (-500 + pz * 4);
      expect(field.heightAt(px, pz)).toBeCloseTo(expected, 6);
    }
  });

  it('agrees with its neighbour along a shared tile border', () => {
    // The seam test. Nodes are snapped to a global lattice precisely so that two tiles interpolate
    // to the same value on their shared edge; laying the grid out from each tile's own origin is
    // the obvious implementation and cracks every tile boundary.
    const height = (x: number, z: number): number => 80 + 30 * Math.sin(x / 97) * Math.cos(z / 131);
    const generator = generatorWithHeight(height);
    const bpp = 4;
    const left = sampleHeightField(generator, 0, 0, SIZE, bpp);
    const right = sampleHeightField(generator, SIZE * bpp, 0, SIZE, bpp);
    for (let pz = 0; pz < SIZE; pz++) {
      // The last column of the left tile and the column just past it are the same world position
      // as the right tile's first column.
      expect(right.heightAt(0, pz)).toBeCloseTo(left.heightAt(SIZE, pz), 9);
    }
  });

  it('samples far fewer columns than a tile has pixels', () => {
    let samples = 0;
    sampleHeightField(
      generatorWithHeight(() => {
        samples++;
        return 70;
      }),
      0,
      0,
      256,
      16,
    );
    // 256*256 = 65 536 pixels. The whole point is not to pay for those.
    expect(samples).toBeLessThan(2000);
  });

  it('reports unavailable rather than zero when the profile has no height field', () => {
    // `tfg` today. A zero height would render as a real, flat, wrong terrain.
    const field = sampleHeightField(generatorWithHeight(() => null), 0, 0, SIZE, 1);
    expect(field.available).toBe(false);
  });
});

describe('hillshade', () => {
  const render = (surfaceY: (x: number, z: number) => number | null): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    hillshadeLayer.render(generatorWithHeight(surfaceY), out, 0, 0, SIZE, 4, {});
    return out;
  };
  const alphaAt = (out: Uint8ClampedArray, px: number, pz: number): number =>
    out[(pz * SIZE + px) * 4 + 3] ?? 0;

  it('leaves flat ground alone', () => {
    // An overlay that tints flat terrain would fog every layer under it.
    const out = render(() => 72);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(0);
  });

  it('shades a slope, darkening the side facing away from the light', () => {
    // Light comes from the north-west, so a slope rising to the east faces away from it.
    const out = render((x) => 64 + x / 8);
    expect(alphaAt(out, 32, 32)).toBeGreaterThan(0);
    const [r, g, b] = [out[(32 * SIZE + 32) * 4], out[(32 * SIZE + 32) * 4 + 1], out[(32 * SIZE + 32) * 4 + 2]];
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('lights the two opposite faces of a ridge differently', () => {
    // The whole point of relief shading: one flank bright, the other dark.
    const out = render((x) => 64 + (x < 128 ? x / 8 : (256 - x) / 8));
    const west = (32 * SIZE + 8) * 4;
    const east = (32 * SIZE + 56) * 4;
    expect(out[west]).not.toBe(out[east]);
    expect(alphaAt(out, 8, 32)).toBeGreaterThan(0);
    expect(alphaAt(out, 56, 32)).toBeGreaterThan(0);
  });

  it('is fully transparent for a profile with no height field', () => {
    const out = render(() => null);
    for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(0);
  });
});

describe('contours', () => {
  const render = (surfaceY: (x: number, z: number) => number | null, bpp = 1): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    contourLayer.render(generatorWithHeight(surfaceY), out, 0, 0, SIZE, bpp, {});
    return out;
  };
  const alphas = (out: Uint8ClampedArray): number[] => {
    const result: number[] = [];
    for (let i = 3; i < out.length; i += 4) result.push(out[i] ?? 0);
    return result;
  };

  it('draws nothing on ground that never crosses a contour', () => {
    // Flat at 100: no band boundary anywhere, and well clear of sea level.
    expect(alphas(render(() => 100)).every((a) => a === 0)).toBe(true);
  });

  it('draws a line where the surface crosses a contour band', () => {
    const drawn = alphas(render((x) => 100 + x / 4)).filter((a) => a > 0).length;
    expect(drawn).toBeGreaterThan(0);
    // Lines, not fills: a slope this gentle must not paint most of the tile.
    expect(drawn).toBeLessThan(SIZE * SIZE * 0.4);
  });

  it('always draws the coastline, and more strongly than an ordinary contour', () => {
    // Sea level is the one contour that matters at a glance, and it rarely falls on a multiple of
    // the interval, so it is drawn separately.
    const out = render((x) => 63 + (x - 32) / 2);
    expect(Math.max(...alphas(out))).toBe(255);
  });

  it('is fully transparent for a profile with no height field', () => {
    expect(alphas(render(() => null)).every((a) => a === 0)).toBe(true);
  });
});

describe('terrain layer sea level', () => {
  it('colours ground below sea level differently from ground above it', () => {
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    const palette = { 'map-bg': 0x000000, 'map-label': 0xffffff, 'map-grid-strong': 0x0000ff };
    // Left half under water, right half above it, both the same distance from sea level.
    terrainLayer.render(
      generatorWithHeight((x) => (x < 128 ? 53 : 73)),
      out,
      0,
      0,
      SIZE,
      4,
      palette,
    );
    const under = (8 * SIZE + 8) * 4;
    const over = (8 * SIZE + 56) * 4;
    // The break is the point: a single ramp through sea level would make these nearly equal.
    expect(out[under + 2]).not.toBe(out[over + 2]);
  });
});
