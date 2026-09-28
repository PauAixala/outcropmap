import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HtmlTagDescriptor, IndexHtmlTransformResult, Plugin } from 'vite';
import { describe, expect, it } from 'vitest';
import { ADS } from '@app/ads-config';
import { REPOSITORY_URL } from '@app/project';
import {
  LICENSE_URL,
  pageDescription,
  renderSitePage,
  structuredData,
  type Json,
} from '@app/site/pages';
import {
  SITE_ORIGIN,
  SITE_PAGES,
  SOCIAL_IMAGE,
  pageUrl,
  sitePage,
  type SitePageId,
} from '@app/site/site';
import { paragraphText, type RenderContext } from '@app/site/markup';
import { en } from '@ui/i18n/en';
import { enSite } from '@ui/i18n/en-site';
import config from '../../vite.config';

/**
 * What a crawler that runs no JavaScript reads (docs/PLAN.md, the SEO pass): each page's metadata,
 * structured data and static text, written at build time by src/app/site/pages.ts.
 */
const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
const render = (file: string, adsEnabled = true): string =>
  renderSitePage(file, read(file), { adsEnabled });

const unescape = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function meta(html: string, key: 'name' | 'property', name: string): string | null {
  const match = new RegExp(`<meta ${key}="${name}" content="([^"]*)"`).exec(html);
  return match ? unescape(match[1]!) : null;
}

function canonical(html: string): string | null {
  const match = /<link rel="canonical" href="([^"]*)"/.exec(html);
  return match ? unescape(match[1]!) : null;
}

type JsonObject = { readonly [key: string]: Json };
const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function graphOf(html: string): JsonObject[] {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(blocks.length).toBe(1);
  const data: unknown = JSON.parse(blocks[0]![1]!);
  const root = data as JsonObject;
  expect(root['@context']).toBe('https://schema.org');
  const graph = root['@graph'];
  expect(Array.isArray(graph)).toBe(true);
  return (graph as readonly Json[]).filter(isObject);
}

const hasType = (node: JsonObject, type: string): boolean => {
  const value = node['@type'];
  return value === type || (Array.isArray(value) && value.includes(type));
};

/** The text a reader sees: no tags, no scripts, entities decoded, whitespace collapsed. A link is
 *  part of its sentence, so its tags go without leaving a space; any other tag breaks the text. */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?a\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ');
  return unescape(text).replace(/\s+/g, ' ').trim();
}

const ctx: RenderContext = {
  values: {},
  ads: true,
  resolve: () => ({ href: '', external: false }),
};

describe('site pages', () => {
  it('builds every page site.json lists, and each file exists', () => {
    expect(SITE_PAGES.map((page) => page.id)).toEqual(['map', 'forge', 'about', 'privacy']);
    for (const page of SITE_PAGES)
      expect([page.file, existsSync(join(ROOT, page.file))]).toEqual([page.file, true]);
    expect(pageUrl('map')).toBe(`${SITE_ORIGIN}/`);
    expect(pageUrl('forge')).toBe(`${SITE_ORIGIN}/forge.html`);
    expect(SITE_ORIGIN).toBe('https://outcropmap.com');
  });

  for (const page of SITE_PAGES) {
    for (const adsEnabled of [true, false]) {
      it(`writes ${page.file}'s title, description, canonical address and social card (ads ${adsEnabled ? 'on' : 'off'})`, () => {
        const html = render(page.file, adsEnabled);
        expect(html).toContain(`<title>${en.pageTitles[page.id]}</title>`);
        const description = meta(html, 'name', 'description');
        expect(description).toBe(pageDescription(page.id, { adsEnabled }));
        expect(description!.length).toBeGreaterThan(50);
        expect(description!.length).toBeLessThanOrEqual(160);
        expect(canonical(html)).toBe(pageUrl(page.id));
        expect(meta(html, 'property', 'og:url')).toBe(pageUrl(page.id));
        expect(meta(html, 'property', 'og:type')).toBe('website');
        expect(meta(html, 'property', 'og:site_name')).toBe(en.appTitle);
        expect(meta(html, 'property', 'og:title')).toBe(en.pageTitles[page.id]);
        expect(meta(html, 'property', 'og:image')).toBe(`${SITE_ORIGIN}/og-image.jpg`);
        expect(meta(html, 'property', 'og:image:width')).toBe('1200');
        expect(meta(html, 'property', 'og:image:height')).toBe('630');
        expect(meta(html, 'property', 'og:image:alt')).toBe(enSite.socialImageAlt);
        expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
        expect(meta(html, 'name', 'twitter:image')).toBe(SOCIAL_IMAGE.url);
        expect(html).not.toMatch(/<!--\s*outcrop:/);
        graphOf(html);
      });
    }

    it(`keeps ${page.file}'s only absolute URLs to its own address and the social image`, () => {
      const html = render(page.file);
      const head = html.slice(0, html.indexOf('</head>')).replace(/<script[\s\S]*?<\/script>/g, '');
      const absolute = [
        ...head.matchAll(/<(\w+)([^>]*?)\s(src|href|content)="((?:https?:)?\/\/[^"]*)"/g),
      ].map((m) => `${m[1]}${/(?:name|property|rel)="([^"]+)"/.exec(m[2]!)?.[1] ?? ''}=${m[4]}`);
      expect(absolute.sort()).toEqual(
        [
          `linkcanonical=${pageUrl(page.id)}`,
          `metaog:url=${pageUrl(page.id)}`,
          `metaog:image=${SOCIAL_IMAGE.url}`,
          `metatwitter:image=${SOCIAL_IMAGE.url}`,
        ].sort(),
      );
      // Every page-to-page link stays relative (ADR 0004): no root-relative paths anywhere.
      for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
        const url = m[1]!;
        expect([url, url.startsWith('/') && !url.startsWith('//')]).toEqual([url, false]);
      }
    });
  }

  it('describes the site, the page and its tool in structured data that parses', () => {
    for (const tool of ['map', 'forge'] as const) {
      const graph = graphOf(render(sitePage(tool).file));
      const website = graph.find((node) => hasType(node, 'WebSite'));
      expect(website?.['url']).toBe(pageUrl('map'));
      expect(website?.['name']).toBe('OutCrop');
      const webPage = graph.find((node) => hasType(node, 'WebPage'));
      expect(webPage?.['url']).toBe(pageUrl(tool));
      const app = graph.find((node) => hasType(node, 'WebApplication'));
      expect(app).toBeDefined();
      expect(app?.['url']).toBe(pageUrl(tool));
      expect(app?.['name']).toBe(enSite.structuredData[tool].name);
      expect(app?.['description']).toBe(enSite.pages[tool].description);
      expect(app?.['applicationCategory']).toBe('UtilitiesApplication');
      expect(app?.['operatingSystem']).toBe('Any; runs in a web browser');
      expect(app?.['isAccessibleForFree']).toBe(true);
      expect(app?.['offers']).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'EUR' });
      expect(app?.['license']).toBe(LICENSE_URL);
      const features = app?.['featureList'];
      expect(Array.isArray(features) ? features.length : 0).toBeGreaterThan(3);
      expect(String(app?.['keywords'])).toMatch(/TerraFirmaCraft/);
      expect(String(app?.['keywords'])).toMatch(/TerraFirmaGreg/);
      const source = graph.find((node) => hasType(node, 'SoftwareSourceCode'));
      expect(source?.['codeRepository']).toBe(REPOSITORY_URL);
      expect(app?.['isBasedOn']).toEqual({ '@id': source?.['@id'] ?? null });
      expect(webPage?.['mainEntity']).toEqual({ '@id': app?.['@id'] ?? null });
    }
  });

  it('puts every question of the About page’s FAQPage on the page, visibly', () => {
    // Google's rule for FAQPage markup: the questions and answers are on the page for a reader.
    const html = render('about.html');
    const page = graphOf(html).find((node) => hasType(node, 'FAQPage'));
    expect(page && hasType(page, 'AboutPage')).toBe(true);
    const questions = (page?.['mainEntity'] as readonly Json[]).filter(isObject);
    expect(questions.map((q) => q['name'])).toEqual(enSite.about.faq.map((q) => q.question));
    const text = visibleText(html);
    for (const question of questions) {
      expect(html).toContain(`<h3>${String(question['name']).replace(/&/g, '&amp;')}</h3>`);
      const answer = question['acceptedAnswer'];
      expect(isObject(answer) && answer['@type']).toBe('Answer');
      expect(text).toContain(String(isObject(answer) ? answer['text'] : ''));
    }
  });

  it('shows each tool’s summary on its page in the About page’s own words', () => {
    const about = visibleText(render('about.html'));
    for (const tool of ['map', 'forge'] as const) {
      const summary = paragraphText(enSite.summaries[tool], ctx);
      expect(about).toContain(summary);
      const html = render(sitePage(tool).file);
      const block = /<section class="static-summary">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? '';
      expect(visibleText(`<body>${block}`)).toContain(summary);
      expect(block).toContain(`href="./about.html"`);
    }
    // Only the map has no heading of its own; the forge's hero keeps the page's one <h1>.
    expect(render('index.html')).toMatch(/<section class="static-summary">\s*<h1>/);
    expect(render('forge.html')).toMatch(/<section class="static-summary">\s*<h2>/);
  });

  it('writes the forge hero with the strings the forge page sets', () => {
    const html = render('forge.html');
    expect(html).toContain(`<h1 id="forge-hero-title">${en.forge.heroTitle}</h1>`);
    expect(html).toContain(
      `<p id="forge-hero-body" class="forge-hero__body">${en.forge.heroBody}</p>`,
    );
  });

  it('writes the privacy policy, with the ads section only in a build with ads', () => {
    const withAds = visibleText(render('privacy.html', true));
    const withoutAds = visibleText(render('privacy.html', false));
    for (const text of [withAds, withoutAds]) {
      expect(text).toContain(en.privacy.title);
      expect(text).toContain(en.privacy.kept);
      expect(text).toContain(en.privacy.hosting);
      expect(text).toContain(`${REPOSITORY_URL}/issues`);
      expect(text).toContain(en.disclaimer);
    }
    expect(withAds).toContain(en.privacy.ads);
    expect(withAds).toContain(en.privacy.adsConsent);
    expect(withAds).not.toContain(en.privacy.noAds);
    expect(withoutAds).toContain(en.privacy.noAds);
    expect(withoutAds).not.toContain(en.privacy.adsHeading);
    expect(render('privacy.html', true)).toContain('href="https://adssettings.google.com/"');
  });

  it('tells a reader of the privacy page where the cookie settings are', () => {
    // The button lives in the header of every page that carries the ad tag, and nowhere else.
    for (const page of SITE_PAGES) {
      if (page.id === 'map' || page.id === 'forge' || page.id === 'about') {
        expect([page.id, page.adScript, en.privacy.adsConsent.includes(en.nav[page.id])]).toEqual([
          page.id,
          true,
          true,
        ]);
      }
    }
    expect(sitePage('privacy').adScript).toBe(false);
    expect(en.privacy.adsConsent).not.toMatch(/every page/);
  });

  it('refuses a page it does not know, a part it cannot place and a part it would drop', () => {
    expect(() => renderSitePage('nope.html', '<title>x</title>', { adsEnabled: true })).toThrow(
      /site\.json/,
    );
    const about = read('about.html');
    expect(() =>
      renderSitePage('about.html', about.replace('<!-- outcrop:about -->', ''), {
        adsEnabled: true,
      }),
    ).toThrow(/outcrop:about/);
    expect(() =>
      renderSitePage(
        'about.html',
        about.replace('<!-- outcrop:about -->', '<!-- outcrop:about --><!-- outcrop:privacy -->'),
        { adsEnabled: true },
      ),
    ).toThrow(/outcrop:privacy/);
    expect(() =>
      renderSitePage('about.html', about.replace(/<title>[^<]*<\/title>/, ''), {
        adsEnabled: true,
      }),
    ).toThrow(/title/);
  });

  it('escapes text into HTML and keeps JSON-LD unable to close its script element', () => {
    const data = structuredData('about', { adsEnabled: true });
    expect(JSON.stringify(data)).not.toMatch(/<\/script/i);
    expect(render('about.html')).not.toMatch(/<\/script>[^<]*<\/script>/);
  });
});

describe('the AdSense tag', () => {
  const isPlugin = (value: unknown): value is Plugin =>
    typeof value === 'object' && value !== null && 'name' in value;
  const plugins = (config.plugins ?? []).flat(3).filter(isPlugin);
  const named = (name: string): Plugin => {
    const plugin = plugins.find((candidate) => candidate.name === name);
    if (!plugin) throw new Error(`vite.config.ts has no ${name} plugin`);
    return plugin;
  };

  async function transform(
    plugin: Plugin,
    file: string,
    html = '',
  ): Promise<IndexHtmlTransformResult | void> {
    const hook = plugin.transformIndexHtml;
    // A hook is a function, or an object carrying it as `handler` (or, the older spelling, `transform`).
    const handler =
      typeof hook === 'function'
        ? hook
        : hook === undefined
          ? undefined
          : 'handler' in hook
            ? hook.handler
            : hook.transform;
    if (!handler) throw new Error(`${plugin.name} has no transformIndexHtml`);
    return handler(html, { path: `/${file}`, filename: join(ROOT, file) });
  }

  const isTags = (result: IndexHtmlTransformResult | void): result is HtmlTagDescriptor[] =>
    Array.isArray(result);

  it('goes on every page that carries ads, and never on the privacy page', async () => {
    for (const page of SITE_PAGES) {
      const result = await transform(named('outcrop-adsense'), page.file);
      expect(isTags(result)).toBe(true);
      const tags = isTags(result) ? result : [];
      const script = tags.find((tag) => tag.tag === 'script');
      const account = tags.find(
        (tag) => tag.tag === 'meta' && tag.attrs?.['name'] === 'google-adsense-account',
      );
      if (ADS.client === '') {
        expect(tags).toEqual([]);
        continue;
      }
      expect([page.file, account?.attrs?.['content']]).toEqual([page.file, ADS.client]);
      expect([page.file, script !== undefined]).toEqual([page.file, page.adScript]);
    }
  });

  it('writes the site pages through the same plugin the build uses', async () => {
    const result = await transform(named('outcrop-site-pages'), 'about.html', read('about.html'));
    expect(typeof result).toBe('string');
    expect(String(result)).toContain(`<title>${en.pageTitles.about}</title>`);
  });
});

// A compile-time check that every page id has a title and a description.
const _titles: Record<SitePageId, string> = en.pageTitles;
void _titles;
