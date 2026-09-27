import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Separate from the `test` block in vite.config.ts on purpose: keeps the preview-rendering script (tools/render-
// preview.ts, run through its tools/render-preview.preview.ts wrapper) out of the normal `npm
// test` run. See tools/render-preview.ts for what this actually renders, and the `preview:render`
// npm script for how this config is invoked.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tools/render-preview.preview.ts'],
    },
  }),
);
