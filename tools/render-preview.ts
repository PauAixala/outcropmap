/**
 * Renders a handful of raster layers straight from the registered `tfc-1.20` generator to PNG
 * files, so the map's current output can be eyeballed without running a browser. Reuses the real
 * profile registration (`@worldgen/profiles`) and the real `RasterLayer.render()` functions
 * (`@layers/raster-layers`) — this module only adds a PNG encoder (Node's built-in `zlib` is
 * enough: 8-bit RGBA, filter byte 0 per scanline, deflate, wrap in IHDR/IDAT/IEND).
 *
 * Run via `npm run preview:render` (see package.json and `render-preview.preview.ts`, the thin
 * vitest wrapper that actually invokes `renderPreviews` below). Not part of the normal `npm test`
 * run: vitest's default `include` only matches `*.test.ts`-style names, so this file and its
 * `.preview.ts` wrapper are invisible to it — only `vitest.preview.config.ts` (which the
 * `preview:render` script points at) includes the wrapper.
 *
 * Seed defaults to 12345; override with the `PREVIEW_SEED` environment variable, e.g.
 * `PREVIEW_SEED=999 npm run preview:render`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import '@worldgen/profiles';
import { createGenerator } from '@worldgen/registry';
import { biomeLayer, rockLayer, temperatureLayer, rainfallLayer } from '@layers/raster-layers';
import type { RasterLayer } from '@layers/types';

export const DEFAULT_SEED = 12345n;

// --- Light-theme tokens (src/ui/styles/base.css) for the few keys these layers read. Renderers
// normally get these from resolved DOM theme tokens (`src/ui/theme/theme.ts`); there is no DOM
// here, so this is a plain object carrying the same light-theme values instead. ---
const LIGHT_PALETTE: Record<string, number> = {
  'map-bg': 0xeceae5,
  accent: 0x8a5a2b,
  text: 0x1b1b19,
  'map-label': 0x1b1b19,
};

// --- Minimal PNG encoder (8-bit RGBA, filter type 0 on every scanline). ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const entry = CRC_TABLE[(c ^ bytes[i]!) & 0xff]!;
    c = entry ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Encodes an 8-bit RGBA buffer (width * height * 4 bytes, no padding) as a PNG file. */
function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (none) for every scanline
    raw.set(rgba.subarray(y * stride, y * stride + stride), rowStart + 1);
  }
  const compressed = deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// --- Render ---

const SIZE = 1024;
const BLOCKS_PER_PIXEL = 32;
const HALF_SPAN = (SIZE / 2) * BLOCKS_PER_PIXEL;
const ORIGIN_X = -HALF_SPAN;
const ORIGIN_Z = -HALF_SPAN;

const VIEWS: readonly { readonly name: string; readonly layer: RasterLayer }[] = [
  { name: 'biomes', layer: biomeLayer },
  { name: 'temperature', layer: temperatureLayer },
  { name: 'rainfall', layer: rainfallLayer },
  { name: 'rock', layer: rockLayer },
];

export interface RenderedView {
  readonly name: string;
  readonly path: string;
  readonly ms: number;
}

/**
 * Renders `biomes`/`temperature`/`rainfall`/`rock` (top layer) from the `tfc-1.20` generator at
 * `seed`, each 1024x1024px centred on the origin at 32 blocks/pixel, and writes them as PNGs into
 * `previews/` at the repo root.
 */
export function renderPreviews(seed: bigint = DEFAULT_SEED): RenderedView[] {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'previews');
  mkdirSync(outDir, { recursive: true });

  const generator = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });

  const results: RenderedView[] = [];
  for (const { name, layer } of VIEWS) {
    const started = performance.now();
    const out = new Uint8ClampedArray(SIZE * SIZE * 4);
    layer.render(generator, out, ORIGIN_X, ORIGIN_Z, SIZE, BLOCKS_PER_PIXEL, LIGHT_PALETTE);
    const png = encodePng(SIZE, SIZE, out);
    const outPath = join(outDir, `${name}.png`);
    writeFileSync(outPath, png);
    results.push({ name, path: outPath, ms: performance.now() - started });
  }
  return results;
}
