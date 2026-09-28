// `defineConfig` from vitest's entry is vite's own plus the `test` block, so one file serves both.
import { configDefaults, defineConfig } from 'vitest/config';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import { basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
// Everything imported from src/ here is loaded by Vite's config loader, which does not resolve the
// aliases defined below: those modules use relative imports only (tests/unit/site-imports.test.ts).
import { ADS, ADS_ENABLED } from './src/app/ads-config';
import { SITE_PAGES, sitePageByFile } from './src/app/site/site';
import { renderSitePage } from './src/app/site/pages';
import { crawlFiles } from './src/app/site/crawl-files';

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Google AdSense, from `ads.config.json`, and nothing at all while its `client` is empty. The
 * account meta goes into every page's head, where AdSense's crawler looks for it when it verifies
 * the site; the tag goes into every page `src/app/site/site.json` marks `adScript` — all but the
 * privacy page, which the consent message links to and which AdSense asks to carry no ad tag.
 * `ads.txt` goes to the site root (Google's certification authority id is the fixed last field).
 * `tools/finish-web-build.mjs` allows exactly this one remote script, and only on those pages.
 */
function adsense(): Plugin {
  return {
    name: 'outcrop-adsense',
    transformIndexHtml(_html, ctx) {
      if (ADS.client === '') return [];
      const tags: HtmlTagDescriptor[] = [
        {
          tag: 'meta',
          attrs: { name: 'google-adsense-account', content: ADS.client },
          injectTo: 'head',
        },
      ];
      if (sitePageByFile(basename(ctx.filename))?.adScript === true) {
        tags.push({
          tag: 'script',
          attrs: {
            async: true,
            src: `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS.client}`,
            crossorigin: 'anonymous',
          },
          injectTo: 'head',
        });
      }
      return tags;
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

/**
 * What makes the site readable without JavaScript (`src/app/site/pages.ts`): each page's title,
 * description, canonical address, social card, structured data and static text, written into the
 * page before Vite processes it (`order: 'pre'`); and robots.txt, sitemap.xml, llms.txt and
 * llms-full.txt at the site root (`src/app/site/crawl-files.ts`). The development server writes the
 * same pages and serves the same files, so what a crawler will read can be checked before a build.
 */
function sitePages(): Plugin {
  const options = { adsEnabled: ADS_ENABLED };
  // The sitemap's lastmod: the day of the build, in UTC. Every page is rebuilt and deployed together.
  const files = () => crawlFiles({ ...options, date: new Date().toISOString().slice(0, 10) });
  return {
    name: 'outcrop-site-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => renderSitePage(basename(ctx.filename), html, options),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        const file = files().find((candidate) => `/${candidate.fileName}` === path);
        if (file === undefined) {
          next();
          return;
        }
        const type = file.fileName.endsWith('.xml') ? 'application/xml' : 'text/plain';
        res.setHeader('Content-Type', `${type}; charset=utf-8`);
        res.end(file.source);
      });
    },
    generateBundle() {
      for (const file of files()) {
        this.emitFile({ type: 'asset', fileName: file.fileName, source: file.source });
      }
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
  plugins: [sitePages(), adsense()],
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
      // Every page in src/app/site/site.json, under its id: map, forge, about, privacy.
      input: Object.fromEntries(SITE_PAGES.map((page) => [page.id, resolvePath(`./${page.file}`)])),
    },
  },
});
