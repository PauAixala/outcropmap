/**
 * Thin vitest wrapper that actually runs `renderPreviews` (see `render-preview.ts`). Kept out of
 * the normal `npm test` run on purpose: vitest's default `include` only matches `*.test.ts`-style
 * names, which this file (named `*.preview.ts`) never does. It is picked up only by
 * `vitest.preview.config.ts`, which the `preview:render` npm script points at explicitly.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, renderPreviews } from './render-preview';

describe('render preview PNGs', () => {
  it('renders biomes/temperature/rainfall/rock to previews/', () => {
    const seedEnv = process.env['PREVIEW_SEED'];
    const seed = seedEnv && seedEnv.length > 0 ? BigInt(seedEnv) : DEFAULT_SEED;
    console.log(`Rendering preview PNGs for seed ${seed}...`);
    const results = renderPreviews(seed);
    for (const r of results) {
      console.log(`  ${r.name}: ${r.path} (${r.ms.toFixed(0)}ms)`);
    }
    expect(results.map((r) => r.name)).toEqual(['biomes', 'temperature', 'rainfall', 'rock']);
  });
});
