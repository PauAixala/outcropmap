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
 *   AdSense tag while `ads.config.json` names a publisher, and only on the pages
 *   `src/app/site/site.json` marks `adScript` — never on the privacy page. A remote `<a href>` is a
 *   link the visitor chooses to follow, and is allowed;
 * - a page a crawler cannot read without JavaScript (src/app/site/pages.ts). Every page must carry
 *   its description, its canonical address, a social card and structured data that parses, and real
 *   text in its HTML. The canonical link, og:url, og:image and twitter:image must be absolute by
 *   their specs, so they — and only they — may name this site's own origin (`site.json`), which is
 *   never fetched as a subresource; robots.txt, sitemap.xml and llms.txt must exist and point there.
 *
 * Usage: node tools/finish-web-build.mjs
 */
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// The site's pages and its own origin, the one read by the build (src/app/site/site.ts).
const site = JSON.parse(readFileSync(path.join(ROOT, 'src/app/site/site.json'), 'utf8'));
const ORIGIN = String(site.origin);
const PAGES = site.pages;
const ownUrl = (url) => url.startsWith(`${ORIGIN}/`);
// Meta tags whose content is a URL and must be absolute (Open Graph, Twitter cards).
const URL_METAS = new Set(['og:url', 'og:image', 'twitter:image']);

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

/** `name="…"`-style attributes of one tag, lower-cased names. */
function attributes(text) {
  const attrs = {};
  for (const m of text.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*"([^"]*)"/g))
    attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

const decode = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

for (const file of walk(OUT)) {
  const relative = path.relative(OUT, file);
  if (file.endsWith('.html')) {
    const html = readFileSync(file, 'utf8');
    for (const tag of html.matchAll(/<([a-zA-Z][\w-]*)([^>]*)>/g)) {
      const name = (tag[1] ?? '').toLowerCase();
      const isNavigation = name === 'a' || name === 'area';
      const attrs = attributes(tag[2] ?? '');
      for (const attr of (tag[2] ?? '').matchAll(/(src|href)\s*=\s*"([^"]*)"/g)) {
        const which = attr[1];
        const url = attr[2] ?? '';
        const remote = /^https?:\/\//i.test(url) || url.startsWith('//');
        const allowed =
          (name === 'script' && which === 'src' && url === ALLOWED_SCRIPT) ||
          // The canonical address is metadata, never fetched, and must be absolute: this site only.
          (name === 'link' && which === 'href' && attrs.rel === 'canonical' && ownUrl(url));
        if (remote && !allowed && !(isNavigation && which === 'href')) {
          problems.push(`${relative} loads a remote subresource in <${name} ${which}>: ${url}`);
        }
        if (url.startsWith('/') && !url.startsWith('//')) {
          problems.push(
            `${relative} uses an absolute path (${url}), which breaks under a subfolder`,
          );
        }
      }
      // A URL in a meta tag is not fetched by the page, but the only ones allowed are the social
      // card's own, on this site.
      if (name === 'meta' && /^(?:https?:)?\/\//i.test(attrs.content ?? '')) {
        const key = attrs.property ?? attrs.name ?? '';
        if (!URL_METAS.has(key) || !ownUrl(attrs.content)) {
          problems.push(`${relative} names a remote URL in <meta ${key}>: ${attrs.content}`);
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

// --- Every page readable without JavaScript (src/app/site/pages.ts) ---

const builtPages = readdirSync(OUT)
  .filter((name) => name.endsWith('.html'))
  .sort();
const listedPages = PAGES.map((page) => page.file).sort();
if (builtPages.join() !== listedPages.join()) {
  problems.push(
    `dist/ holds ${builtPages.join(', ')} but site.json lists ${listedPages.join(', ')}`,
  );
}

function metaContent(html, key, name) {
  for (const tag of html.matchAll(/<meta\b([^>]*)>/g)) {
    const attrs = attributes(tag[1] ?? '');
    if (attrs[key] === name) return decode(attrs.content ?? '');
  }
  return null;
}

/** The words a reader sees in the body, scripts and comments aside. */
function bodyWords(html) {
  const body = html.slice(html.indexOf('<body'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode(text)
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word)).length;
}

for (const page of PAGES) {
  const file = path.join(OUT, page.file);
  if (!existsSync(file)) {
    problems.push(`${page.file} is listed in site.json but was not built`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const url = `${ORIGIN}${page.path}`;
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? '';
  if (title === '' || title === 'OutCrop') problems.push(`${page.file} has no descriptive <title>`);
  if ((metaContent(html, 'name', 'description') ?? '').trim().length < 50)
    problems.push(`${page.file} has no meta description a search result could show`);
  const canonical = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0] ?? '';
  if (attributes(canonical).href !== url)
    problems.push(`${page.file} lacks <link rel="canonical" href="${url}">`);
  if (metaContent(html, 'property', 'og:url') !== url)
    problems.push(`${page.file}: og:url is not ${url}`);
  for (const [key, name] of [
    ['property', 'og:image'],
    ['name', 'twitter:image'],
  ]) {
    const image = metaContent(html, key, name) ?? '';
    if (!ownUrl(image)) problems.push(`${page.file}: ${name} is not an image on ${ORIGIN}`);
    else if (!existsSync(path.join(OUT, image.slice(ORIGIN.length + 1))))
      problems.push(`${page.file}: ${name} ${image} is not in dist/`);
  }
  for (const [key, name] of [
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['property', 'og:image:alt'],
    ['name', 'twitter:card'],
  ]) {
    if ((metaContent(html, key, name) ?? '') === '') problems.push(`${page.file} lacks ${name}`);
  }
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (blocks.length === 0) problems.push(`${page.file} has no structured data (JSON-LD)`);
  for (const block of blocks) {
    let data = null;
    try {
      data = JSON.parse(block[1] ?? '');
    } catch (error) {
      problems.push(`${page.file}: its JSON-LD does not parse (${error.message})`);
      continue;
    }
    // Google's FAQPage rule: every question is on the page for a reader to see.
    for (const node of Array.isArray(data?.['@graph']) ? data['@graph'] : [data]) {
      const types = [].concat(node?.['@type'] ?? []);
      if (!types.includes('FAQPage')) continue;
      for (const question of node.mainEntity ?? []) {
        const text = String(question?.name ?? '');
        const shown = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (text === '' || !html.includes(`>${shown}</h3>`))
          problems.push(`${page.file}: FAQ question "${text}" is not on the page`);
      }
    }
  }
  if (/<!--\s*outcrop:/.test(html))
    problems.push(`${page.file} still holds an unfilled <!-- outcrop: --> marker`);
  // What a crawler that runs no JavaScript reads. The map, the thinnest page, carries ~100 words.
  if (bodyWords(html) < 40) problems.push(`${page.file} has almost no text without JavaScript`);
}

// --- The files crawlers read first ---

function readOut(name) {
  try {
    return readFileSync(path.join(OUT, name), 'utf8');
  } catch {
    problems.push(`${name} is missing from dist/`);
    return null;
  }
}

const robots = readOut('robots.txt');
if (robots !== null) {
  if (!/^User-agent: \*\s*\nAllow: \/\s*$/m.test(robots))
    problems.push('robots.txt does not allow everything to *');
  const blocked = robots.split('\n').filter((line) => /^\s*disallow\s*:\s*\S/i.test(line));
  if (blocked.length > 0) problems.push(`robots.txt disallows something: ${blocked.join('; ')}`);
  // AdSense verification and review need its crawler, which ignores the * group.
  if (!/^User-agent: Mediapartners-Google\s*\nAllow: \/\s*$/m.test(robots))
    problems.push('robots.txt does not name Mediapartners-Google as allowed');
  const sitemaps = robots.split('\n').filter((line) => /^sitemap\s*:/i.test(line));
  if (sitemaps.length !== 1 || sitemaps[0].trim() !== `Sitemap: ${ORIGIN}/sitemap.xml`)
    problems.push(`robots.txt does not point to ${ORIGIN}/sitemap.xml`);
}

const sitemap = readOut('sitemap.xml');
if (sitemap !== null) {
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const expected = PAGES.map((page) => `${ORIGIN}${page.path}`);
  if (!sitemap.startsWith('<?xml') || !sitemap.includes('<urlset'))
    problems.push('sitemap.xml is not a sitemap');
  if (locs.some((loc) => !ownUrl(loc))) problems.push(`sitemap.xml lists a URL off ${ORIGIN}`);
  if (locs.join() !== expected.join())
    problems.push(`sitemap.xml lists ${locs.join(', ')}, not ${expected.join(', ')}`);
}

const llms = readOut('llms.txt');
if (llms !== null) {
  const lines = llms.split('\n');
  if (!lines[0]?.startsWith('# ') || !lines.some((line) => line.startsWith('> ')))
    problems.push('llms.txt lacks its title and summary (llmstxt.org)');
  for (const page of PAGES) {
    if (!llms.includes(`](${ORIGIN}${page.path})`))
      problems.push(`llms.txt does not link ${page.file}`);
  }
}
readOut('llms-full.txt');

// --- A build with ads must carry ads.txt for the same publisher, and the tag exactly where
// site.json says; a build without ads must carry neither. ---
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
  for (const page of PAGES) {
    if (!existsSync(path.join(OUT, page.file))) continue; // reported above
    const html = readFileSync(path.join(OUT, page.file), 'utf8');
    if (metaContent(html, 'name', 'google-adsense-account') !== client)
      problems.push(`${page.file} lacks the google-adsense-account meta for ${client}`);
    const tagged = html.includes(ALLOWED_SCRIPT);
    if (page.adScript && !tagged)
      problems.push(`${page.file} lacks the AdSense tag although ads.config.json names a client`);
    if (!page.adScript && tagged)
      problems.push(
        `${page.file} carries the AdSense tag, which AdSense asks the privacy page not to (answer 10961370)`,
      );
  }
} else if (adsTxt !== null) {
  problems.push('ads.txt is in dist/ although ads.config.json names no client');
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(`build:web failed — ${problems.length} problem(s) in dist/`);
  process.exit(1);
}

const tagged = PAGES.filter((page) => page.adScript)
  .map((page) => page.file)
  .join(', ');
console.log(
  client === ''
    ? `dist/ carries LICENSE and NOTICE.md, uses relative paths, loads nothing remote, and gives crawlers robots.txt, sitemap.xml, llms.txt and ${PAGES.length} readable pages`
    : `dist/ carries LICENSE, NOTICE.md and ads.txt, uses relative paths, loads only the AdSense tag for ${client} (on ${tagged}), and gives crawlers robots.txt, sitemap.xml, llms.txt and ${PAGES.length} readable pages`,
);
