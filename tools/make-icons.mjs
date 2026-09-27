#!/usr/bin/env node
/**
 * Generates the site's favicon, `public/icons/favicon-32.png`.
 *
 * The artwork is our own — an anvil on a 16x16 grid, the same shape language as the forge mark and
 * the waypoint glyphs (docs/DESIGN.md section 6). Nothing here is traced from the mod (AGENTS.md
 * section 8), and no image library is involved: the pixels are written by hand and encoded by
 * `tools/lib/png.mjs`.
 *
 * Scaling is integer nearest-neighbour on purpose: every source pixel becomes a whole 2x2 square,
 * so the icon stays crisp instead of being resampled into mush.
 *
 * Usage: node tools/make-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The anvil, 16x16. One character per pixel:
 *   '.' transparent · 'k' outline · 'h' steel highlight · 's' steel · 'd' steel shadow
 *
 * The silhouette is the readable part at 16px: a wide struck face, an undercut waist, a flared foot.
 */
const ANVIL = [
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '..khhhhhhhhhhk..',
  '..ksssssssssdk..',
  '..kddddddddddk..',
  '...kkssssssdk...',
  '....kdssssdk....',
  '.....kssssk.....',
  '.....kssssk.....',
  '.....kdssdk.....',
  '....kksssskk....',
  '...khhssssddk...',
  '...ksssssssdk...',
  '...kddddddddk...',
  '...kkkkkkkkkk...',
];

/** Anvil palette, matching the `--forge-*` tokens in the light theme. */
const COLOURS = {
  k: [0x17, 0x17, 0x17, 0xff],
  h: [0x8f, 0x95, 0x9c, 0xff],
  s: [0x6b, 0x70, 0x76, 0xff],
  d: [0x3e, 0x42, 0x47, 0xff],
  '.': [0, 0, 0, 0],
};

/** Renders the character grid at `scale`, nearest-neighbour, onto a transparent canvas. */
function render(grid, scale, background) {
  const size = grid.length * scale;
  const rgba = new Uint8Array(size * size * 4);
  if (background) {
    for (let i = 0; i < size * size; i++) {
      rgba[i * 4] = background[0];
      rgba[i * 4 + 1] = background[1];
      rgba[i * 4 + 2] = background[2];
      rgba[i * 4 + 3] = background[3];
    }
  }
  grid.forEach((row, y) => {
    [...row].forEach((char, x) => {
      const colour = COLOURS[char] ?? COLOURS['.'];
      if (colour[3] === 0) return;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const index = ((y * scale + dy) * size + (x * scale + dx)) * 4;
          rgba[index] = colour[0];
          rgba[index + 1] = colour[1];
          rgba[index + 2] = colour[2];
          rgba[index + 3] = colour[3];
        }
      }
    });
  });
  return { size, rgba };
}

// The site's favicon: the same anvil at 2x, in public/ so the build carries it.
const favicon = render(ANVIL, 2, null);
const publicIcons = path.join(ROOT, 'public', 'icons');
mkdirSync(publicIcons, { recursive: true });
writeFileSync(
  path.join(publicIcons, 'favicon-32.png'),
  encodePng(favicon.size, favicon.size, favicon.rgba),
);
console.log('public/icons/favicon-32.png');
