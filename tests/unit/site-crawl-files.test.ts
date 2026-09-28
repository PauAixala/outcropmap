import { describe, expect, it } from 'vitest';
import {
  NAMED_CRAWLERS,
  crawlFiles,
  llmsFullTxt,
  llmsTxt,
  robotsTxt,
  sitemapXml,
} from '@app/site/crawl-files';
import { siteFacts } from '@app/site/facts';
import { SITE_ORIGIN, SITE_PAGES, pageUrl } from '@app/site/site';
import { REPOSITORY_URL } from '@app/project';
import { enSite } from '@ui/i18n/en-site';

/** robots.txt, sitemap.xml and llms.txt, as src/app/site/crawl-files.ts writes them. */
describe('robots.txt', () => {
  const robots = robotsTxt();
  const lines = robots.split('\n');

  it('allows everything to everyone and disallows nothing', () => {
    expect(robots).toMatch(/^User-agent: \*\nAllow: \/$/m);
    expect(lines.filter((line) => /^disallow\s*:/i.test(line))).toEqual([]);
  });

  it('names the crawlers AdSense, search and AI assistants use, each allowed everything', () => {
    const named = NAMED_CRAWLERS.flatMap((group) => group.agents);
    for (const agent of [
      // AdSense: verification and review need these (AdSense Help, "Add a new site").
      'Mediapartners-Google',
      'Google-Display-Ads-Bot',
      'Googlebot',
      'Bingbot',
      'GPTBot',
      'OAI-SearchBot',
      'ChatGPT-User',
      'ClaudeBot',
      'Claude-SearchBot',
      'Claude-User',
      'PerplexityBot',
      'Perplexity-User',
      'Google-Extended',
      'Applebot-Extended',
      'CCBot',
    ]) {
      expect(named).toContain(agent);
    }
    for (const agent of named) {
      const at = lines.indexOf(`User-agent: ${agent}`);
      expect([agent, at >= 0 && lines[at + 1] === 'Allow: /']).toEqual([agent, true]);
    }
    expect(new Set(named).size).toBe(named.length);
  });

  it('points to the sitemap, absolutely', () => {
    expect(lines.filter((line) => line.startsWith('Sitemap:'))).toEqual([
      `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    ]);
  });
});

describe('sitemap.xml', () => {
  const xml = sitemapXml('2026-09-28');

  it('lists every page, absolute and on this site, with the build date', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(SITE_PAGES.map((page) => pageUrl(page.id)));
    for (const loc of locs) expect(loc?.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    expect([...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1])).toEqual(
      SITE_PAGES.map(() => '2026-09-28'),
    );
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ),
    ).toBe(true);
  });

  it('refuses a date that is not a calendar day', () => {
    expect(() => sitemapXml('2026-09-28T00:00:00Z')).toThrow();
  });
});

describe('llms.txt', () => {
  const text = llmsTxt({ adsEnabled: true });
  const lines = text.split('\n');

  it('follows llmstxt.org: a title, a summary quote, then sections of links', () => {
    expect(lines[0]).toBe('# OutCrop');
    expect(lines.find((line) => line.startsWith('> '))).toBe(`> ${enSite.llms.summary}`);
    const headings = lines.filter((line) => line.startsWith('## '));
    expect(headings).toEqual(['## Tools', '## About', '## Optional']);
    const links = lines.filter((line) => line.startsWith('- '));
    for (const link of links) expect(link).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\): \S/);
  });

  it('links every page absolutely, the source code, and the full text', () => {
    for (const page of SITE_PAGES) expect(text).toContain(`](${pageUrl(page.id)})`);
    expect(text).toContain(`](${REPOSITORY_URL})`);
    expect(text).toContain(`](${SITE_ORIGIN}/llms-full.txt)`);
  });
});

describe('llms-full.txt', () => {
  const full = llmsFullTxt({ adsEnabled: true });

  it('carries the whole About page as Markdown, questions included', () => {
    expect(full.startsWith(`# ${enSite.about.title}\n`)).toBe(true);
    for (const section of enSite.about.sections)
      expect(full).toContain(`\n## ${section.heading}\n`);
    for (const question of enSite.about.faq) expect(full).toContain(`\n### ${question.question}\n`);
    expect(full).not.toMatch(/<\/?[a-z][^>]*>/);
    expect(full).not.toMatch(/\{[A-Za-z]+\}/);
    const { kaolin } = siteFacts();
    expect(full).toContain(`between Y ${kaolin.minY} and ${kaolin.maxY}`);
  });

  it('writes the ads sentences only in a build with ads', () => {
    const noAds = llmsFullTxt({ adsEnabled: false });
    expect(full).toContain('Google AdSense');
    expect(noAds).not.toContain('Google AdSense');
    expect(noAds).toContain('shows no ads');
  });
});

describe('crawl files', () => {
  it('are the four root files the build emits', () => {
    expect(
      crawlFiles({ adsEnabled: true, date: '2026-09-28' }).map((file) => file.fileName),
    ).toEqual(['robots.txt', 'sitemap.xml', 'llms.txt', 'llms-full.txt']);
  });
});
