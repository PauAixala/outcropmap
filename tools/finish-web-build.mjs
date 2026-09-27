#!/usr/bin/env node
/**
 * Finishes the static web build: copies the licence and the attribution into `dist/`, then checks
 * the output keeps the promises the site makes.
 *
 * The licence travels with the site because EUPL-1.2's definition of Distribution covers "making
 * available, online or offline": publishing the site is distribution, and this project is entirely
 * client-side, so the code is literally copied to every visitor's machine.
 *
 * The checks fail the build rather than wait for a visitor to notice:
 * - an absolute path in a page breaks the site under a subfolder, which is how GitHub Pages serves it;
 * - a remote subresource, remote code or a remote stylesheet resource breaks the promise that the
 *   site loads nothing else from the network (README.md, "Privacy"). The one exception is the
 *   AdSense tag while `ads.config.json` names a publisher. A remote `<a href>` is a link the
 *   visitor chooses to follow, and is allowed.
 *
 * Usage: node tools/finish-web-build.mjs
 */
import { copyFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'dist');

// The one exception to "nothing remote": the AdSense tag, and only while ads.config.json names a
// publisher (vite.config.ts writes it). Anything else remote still fails the build.
const ads = JSON.parse(readFileSync(path.join(ROOT, 'ads.config.json'), 'utf8'));
const client = typeof ads.client === 'string' ? ads.client.trim() : '';
const ALLOWED_SCRIPT =
  client === ''
    ? null
    : `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;

for (const file of ['LICENSE', 'NOTICE.md']) {
  copyFileSync(path.join(ROOT, file), path.join(OUT, file));
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const problems = [];

for (const required of ['LICENSE', 'NOTICE.md']) {
  try {
    statSync(path.join(OUT, required));
  } catch {
    problems.push(`${required} did not reach dist/ — EUPL-1.2 requires it to travel with the work`);
  }
}

const REMOTE_JS = [
  [/\bimport\s*\(\s*["'`]https?:/i, 'imports remote code'],
  [/\bimportScripts\s*\(\s*["'`]https?:/i, 'imports remote scripts into a worker'],
  [/\bfetch\s*\(\s*["'`]https?:/i, 'fetches a remote URL'],
  [
    /\bnew\s+(?:Shared)?Worker\s*\(\s*(?:new\s+URL\s*\(\s*)?["'`]https?:/i,
    'starts a worker from a remote script',
  ],
];

for (const file of walk(OUT)) {
  const relative = path.relative(OUT, file);
  if (file.endsWith('.html')) {
    const html = readFileSync(file, 'utf8');
    for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const name = (tag[1] ?? '').toLowerCase();
      const isNavigation = name === 'a' || name === 'area';
      for (const attr of (tag[2] ?? '').matchAll(/(src|href)\s*=\s*"([^"]*)"/g)) {
        const which = attr[1];
        const url = attr[2] ?? '';
        const remote = /^https?:\/\//i.test(url) || url.startsWith('//');
        const allowed = name === 'script' && which === 'src' && url === ALLOWED_SCRIPT;
        if (remote && !allowed && !(isNavigation && which === 'href')) {
          problems.push(`${relative} loads a remote subresource in <${name} ${which}>: ${url}`);
        }
        if (url.startsWith('/') && !url.startsWith('//')) {
          problems.push(
            `${relative} uses an absolute path (${url}), which breaks under a subfolder`,
          );
        }
      }
    }
  }
  if (file.endsWith('.js')) {
    const js = readFileSync(file, 'utf8');
    for (const [pattern, what] of REMOTE_JS) {
      if (pattern.test(js)) problems.push(`${relative} ${what} at runtime`);
    }
  }
  if (file.endsWith('.css') || file.endsWith('.html')) {
    const text = readFileSync(file, 'utf8');
    const sheets = file.endsWith('.css')
      ? [text]
      : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '');
    for (const css of sheets) {
      if (
        /url\(\s*["']?\s*(?:https?:)?\/\//i.test(css) ||
        /@import\s+(?:url\(\s*)?["']?https?:/i.test(css)
      ) {
        problems.push(`${relative} loads a remote resource from CSS`);
      }
    }
  }
}

// A build with ads must carry ads.txt for the same publisher; a build without ads must carry neither.
let adsTxt = null;
try {
  adsTxt = readFileSync(path.join(OUT, 'ads.txt'), 'utf8');
} catch {
  adsTxt = null;
}
if (client !== '') {
  const expected = `google.com, ${client.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0`;
  if (adsTxt === null || !adsTxt.includes(expected))
    problems.push(`ads.txt is missing or does not read "${expected}"`);
  for (const page of ['index.html', 'forge.html', 'privacy.html']) {
    const html = readFileSync(path.join(OUT, page), 'utf8');
    if (!html.includes(ALLOWED_SCRIPT))
      problems.push(`${page} lacks the AdSense tag although ads.config.json names a client`);
  }
} else if (adsTxt !== null) {
  problems.push('ads.txt is in dist/ although ads.config.json names no client');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(`build:web failed — ${problems.length} problem(s) in dist/`);
  process.exit(1);
}

console.log(
  client === ''
    ? 'dist/ carries LICENSE and NOTICE.md, uses relative paths and loads nothing remote'
    : `dist/ carries LICENSE, NOTICE.md and ads.txt, uses relative paths, and loads only the AdSense tag for ${client}`,
);
