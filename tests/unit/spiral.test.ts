import { describe, expect, it } from 'vitest';
import { spiralOffsets } from '../../src/render/tiles/spiral';

describe('spiralOffsets', () => {
  it('the first offset is always the centre tile itself', () => {
    for (const radius of [0, 1, 2, 5]) {
      expect(spiralOffsets(radius)[0]).toEqual({ tx: 0, tz: 0 });
    }
  });

  it('radius 0 yields only the centre tile', () => {
    expect(spiralOffsets(0)).toEqual([{ tx: 0, tz: 0 }]);
  });

  it('matches the hand-worked clockwise order for the first ring (radius 1)', () => {
    // East, south, west, north -- clockwise on a y-down grid (+tx east, +tz south), starting due
    // east of the centre, exactly the reading order docs/FEEDBACK.md asked for.
    expect(spiralOffsets(1)).toEqual([
      { tx: 0, tz: 0 },
      { tx: 1, tz: 0 }, // east
      { tx: 1, tz: 1 }, // south-east
      { tx: 0, tz: 1 }, // south
      { tx: -1, tz: 1 }, // south-west
      { tx: -1, tz: 0 }, // west
      { tx: -1, tz: -1 }, // north-west
      { tx: 0, tz: -1 }, // north
      { tx: 1, tz: -1 }, // north-east
    ]);
  });

  it('covers every integer tile within the radius exactly once, for several radii', () => {
    for (const radius of [1, 2, 3, 4, 7]) {
      const offsets = spiralOffsets(radius);
      const expectedCount = (2 * radius + 1) ** 2;
      expect(offsets).toHaveLength(expectedCount);

      const seen = new Set<string>();
      for (const { tx, tz } of offsets) {
        const key = `${tx},${tz}`;
        expect(seen.has(key)).toBe(false); // exactly once
        seen.add(key);
        expect(Math.max(Math.abs(tx), Math.abs(tz))).toBeLessThanOrEqual(radius);
      }
      // Every tile in the (2r+1)x(2r+1) square is present.
      for (let tz = -radius; tz <= radius; tz++) {
        for (let tx = -radius; tx <= radius; tx++) {
          expect(seen.has(`${tx},${tz}`)).toBe(true);
        }
      }
    }
  });

  it('each ring is a true spiral: consecutive offsets are always orthogonally adjacent', () => {
    const offsets = spiralOffsets(4);
    for (let i = 1; i < offsets.length; i++) {
      const a = offsets[i - 1]!;
      const b = offsets[i]!;
      const manhattan = Math.abs(a.tx - b.tx) + Math.abs(a.tz - b.tz);
      expect(manhattan).toBe(1);
    }
  });

  it('is deterministic and stable: repeated calls with the same radius produce the same order', () => {
    const a = spiralOffsets(6);
    const b = spiralOffsets(6);
    expect(a).toEqual(b);
  });

  it('a larger radius extends the same sequence rather than reordering the inner rings', () => {
    const small = spiralOffsets(2);
    const large = spiralOffsets(3);
    expect(large.slice(0, small.length)).toEqual(small);
  });

  it('rejects a negative radius the same as zero, and floors a fractional one', () => {
    expect(spiralOffsets(-3)).toEqual([{ tx: 0, tz: 0 }]);
    expect(spiralOffsets(1.9)).toEqual(spiralOffsets(1));
  });
});
