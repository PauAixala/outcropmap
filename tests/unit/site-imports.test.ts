import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * vite.config.ts imports the site modules (`src/app/site/`, `src/ui/i18n/en.ts`, `en-site.ts`,
 * `src/app/ads-config.ts`) to write each page's metadata and static text at build time. Vite's
 * config loader bundles those imports itself and does not resolve the aliases the config defines,
 * so an `@data/…` or `@ui/…` import anywhere in that graph breaks every build, dev server and test
 * run at startup, with "Cannot find module". This keeps the graph on relative paths.
 */
const ROOT = process.cwd();

/** Runtime import specifiers in `source`: `import … from`, `export … from` and bare `import '…'`.
 *  `import type` is erased before anything runs, so it is not a dependency here. */
function runtimeImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(
    /^\s*(import|export)\s+(type\s+)?[^'";]*?\bfrom\s+['"]([^'"]+)['"]/gm,
  )) {
    if (m[2] === undefined) found.push(m[3]!);
  }
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(m[1]!);
  return found;
}

function resolveModule(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (/\.(ts|json)$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  throw new Error(`${relative(ROOT, fromFile)}: cannot resolve ${specifier}`);
}

/** Every file vite.config.ts pulls in from src/, with the non-relative imports each makes. */
function configGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [join(ROOT, 'vite.config.ts')];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (graph.has(file)) continue;
    const bare: string[] = [];
    graph.set(file, bare);
    if (file.endsWith('.json')) continue;
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolveModule(file, specifier));
      else bare.push(specifier);
    }
  }
  return graph;
}

describe('the modules vite.config.ts loads', () => {
  const graph = configGraph();
  const files = [...graph.keys()].map((file) => relative(ROOT, file).replace(/\\/g, '/'));

  it('include the site text and the site modules', () => {
    for (const expected of [
      'src/ui/i18n/en.ts',
      'src/ui/i18n/en-site.ts',
      'src/app/site/site.ts',
      'src/app/site/pages.ts',
      'src/app/site/crawl-files.ts',
      'src/app/site/facts.ts',
      'src/app/ads-config.ts',
    ]) {
      expect(files).toContain(expected);
    }
  });

  it('import nothing but relative paths, apart from the config itself', () => {
    const offenders = [...graph.entries()]
      .filter(([file]) => !file.endsWith('vite.config.ts'))
      .flatMap(([file, bare]) =>
        bare.map((specifier) => `${relative(ROOT, file)} imports ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });

  it('leaves the config itself to packages and Node built-ins, never an alias', () => {
    const own = graph.get(join(ROOT, 'vite.config.ts')) ?? [];
    expect(own.filter((specifier) => specifier.startsWith('@'))).toEqual([]);
  });
});
