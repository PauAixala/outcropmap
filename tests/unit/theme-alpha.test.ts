import { describe, expect, it } from 'vitest';
import { parseAlpha } from '../../src/ui/theme/theme';

// The grid tokens are `#rrggbbaa`. Dropping that alpha painted the grid solid white on dark and
// solid black on light, which is how it came to dominate the map.
describe('parseAlpha', () => {
  it('reads the alpha of 8- and 4-digit hex', () => {
    expect(parseAlpha('#ffffff1c')).toBeCloseTo(0x1c / 255);
    expect(parseAlpha('  #0000003f ')).toBeCloseTo(0x3f / 255);
    expect(parseAlpha('#0008')).toBeCloseTo(0x88 / 255);
  });

  it('treats colours without an alpha as opaque', () => {
    expect(parseAlpha('#1d1a14')).toBe(1);
    expect(parseAlpha('#fff')).toBe(1);
    expect(parseAlpha('rgb(10, 20, 30)')).toBe(1);
  });

  it('reads rgba() in comma, space and percentage forms', () => {
    expect(parseAlpha('rgba(0, 0, 0, 0.25)')).toBe(0.25);
    expect(parseAlpha('rgb(0 0 0 / 40%)')).toBeCloseTo(0.4);
  });
});
