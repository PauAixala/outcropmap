// `defineConfig` from vitest's entry is vite's own plus the `test` block, so one file serves both.
import { configDefaults, defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { ADS } from './src/app/ads-config';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Google AdSense, from `ads.config.json`, and nothing at all while its `client` is empty. The tag
 * and the account meta go into every page's head, where AdSense's crawler looks for them when it
 * verifies the site, and `ads.txt` goes to the site root (Google's certification authority id is
 * the fixed last field). `tools/finish-web-build.mjs` allows exactly this one remote script.
 */
function adsense(): Plugin {
  return {
    name: 'outcrop-adsense',
    transformIndexHtml() {
      if (ADS.client === '') return [];
      return [
        {
          tag: 'meta',
          attrs: { name: 'google-adsense-account', content: ADS.client },
          injectTo: 'head',
        },
        {
          tag: 'script',
          attrs: {
            async: true,
            src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS.client}`,
            crossorigin: 'anonymous',
          },
          injectTo: 'head',
        },
      ];
    },
    generateBundle() {
      if (ADS.client === '') return;
      const publisher = ADS.client.replace(/^ca-/, '');
      this.emitFile({
        type: 'asset',
        fileName: 'ads.txt',
        source: `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`,
      });
    },
  };
}

// WATCH_POLL=1 makes the dev server poll for changes rather than trust filesystem events, which
// do not always cross a bind mount. `CHOKIDAR_USEPOLLING` does not cover this: that variable is
// chokidar's own and Vite configures its watcher itself.
const pollForChanges = process.env.WATCH_POLL === '1';

export default defineConfig({
  // Relative base, so the site works from any subfolder: GitHub Pages serves it under /<repository>/.
  base: './',
  plugins: [adsense()],
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@worldgen': resolvePath('./src/worldgen'),
      '@forge': resolvePath('./src/forge'),
      '@layers': resolvePath('./src/layers'),
      '@render': resolvePath('./src/render'),
      '@ui': resolvePath('./src/ui'),
      '@app': resolvePath('./src/app'),
      '@platform': resolvePath('./src/platform'),
      '@workers': resolvePath('./src/workers'),
      '@data': resolvePath('./src/data'),
      '@util': resolvePath('./src/util'),
    },
  },
  worker: {
    format: 'es',
  },
  // Agent worktrees under `.kilo/` hold whole stale copies of the repository, tests included, and
  // vitest collected them: the documented gate ran every test twice and failed on the copy's
  // leftovers. The defaults stay; `.kilo/**` is added on top.
  test: {
    exclude: [...configDefaults.exclude, '.kilo/**'],
    // Vitest 5 holds synchronous tests to the timeout too, and the generator sweeps here run for
    // minutes by design. Vitest 2 never timed a synchronous test, so this keeps what passed passing.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
  // `exactOptionalPropertyTypes` is on, so this is spread rather than set to undefined.
  ...(pollForChanges ? { server: { watch: { usePolling: true, interval: 400 } } } : {}),
  build: {
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        map: resolvePath('./index.html'),
        forge: resolvePath('./forge.html'),
        privacy: resolvePath('./privacy.html'),
      },
    },
  },
});
