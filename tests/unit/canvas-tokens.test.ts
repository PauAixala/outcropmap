import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKEN_ABSENT, tokenColour } from '@render/tokens';

/**
 * The canvas paints with theme tokens, never with a copy of one.
 *
 * `painter.ts` held 16 hex fallbacks and `raster-layers.ts` 5, each a copy of a token's value
 * that had drifted or would. They now read `tokenColour`, and this holds them to it.
 */
const read = (file: string): string => readFileSync(join(process.cwd(), file), 'utf8');
const RENDERERS = ['src/render/canvas2d/painter.ts', 'src/layers/raster-layers.ts'];

describe('canvas colours come from tokens', () => {
  it('reads a token, and reads an absent one as TOKEN_ABSENT rather than a guess', () => {
    expect(tokenColour({ 'map-bg': 0x1b1d20 }, 'map-bg')).toBe(0x1b1d20);
    expect(tokenColour({}, 'map-bg')).toBe(TOKEN_ABSENT);
  });

  it('holds no packed colour literal in the painter or the raster layers', () => {
    for (const file of RENDERERS) {
      expect([file, read(file).match(/0x[0-9a-fA-F]{6}\b/g) ?? []]).toEqual([file, []]);
    }
  });

  it('only names tokens base.css declares, in both themes', () => {
    const css = read('src/ui/styles/base.css');
    const named = new Set(RENDERERS.flatMap((file) => [...read(file).matchAll(/tokenColour\(palette, '([a-z-]+)'\)/g)].map((m) => m[1]!)));
    expect(named.size).toBeGreaterThan(5);
    for (const token of named) {
      const declared = css.match(new RegExp(`--${token}:`, 'g'))?.length ?? 0;
      expect([token, declared >= 2]).toEqual([token, true]);
    }
  });
});
