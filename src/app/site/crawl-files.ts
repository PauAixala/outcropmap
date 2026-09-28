/**
 * The files at the site root that crawlers read before any page: robots.txt, sitemap.xml, and
 * llms.txt with its companion llms-full.txt (https://llmstxt.org). vite.config.ts emits them at
 * build time, and the development server serves the same text.
 *
 * llms.txt and llms-full.txt are rendered from the About page's own text (`en-site.ts`), so what a
 * language model reads about OutCrop is what a visitor reads.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import { en } from '../../ui/i18n/en';
import { enSite } from '../../ui/i18n/en-site';
import type { SiteQuestion, SiteSection } from '../../ui/i18n/en-site';
import { blocksMarkdown, escapeMarkdown, escapeText, paragraphText } from './markup';
import type { RenderContext } from './markup';
import { linkTarget, renderContext } from './pages';
import type { SiteBuildOptions } from './pages';
import { SITE_PAGES, pageUrl, siteUrl } from './site';

/**
 * Crawlers named in robots.txt, each allowed everything. `User-agent: *` already allows them; they
 * are named because some look only for their own group, and to say plainly that OutCrop wants to be
 * read and recommended. Tokens as each operator documents them (checked 2026-09-28).
 */
export const NAMED_CRAWLERS: readonly {
  readonly note: string;
  readonly agents: readonly string[];
}[] = [
  {
    // AdSense Help, "Add a new site": both must reach the site for verification and review. Google
    // documents that Mediapartners-Google ignores the `*` group ("Google special-case crawlers").
    note: 'Google AdSense: Mediapartners-Google ignores the * group, so its crawlers are named.',
    agents: ['Mediapartners-Google', 'Google-Display-Ads-Bot'],
  },
  { note: 'Search engines.', agents: ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot'] },
  {
    note: 'OpenAI: ChatGPT search, fetches a user asks for, and training.',
    agents: ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot'],
  },
  {
    note: 'Anthropic: Claude search, fetches a user asks for, and training.',
    agents: ['Claude-SearchBot', 'Claude-User', 'ClaudeBot'],
  },
  {
    note: 'Perplexity: search, and fetches a user asks for.',
    agents: ['PerplexityBot', 'Perplexity-User'],
  },
  {
    note: 'Gemini and Apple Intelligence: may use what Googlebot and Applebot fetch.',
    agents: ['Google-Extended', 'Applebot-Extended'],
  },
  {
    note: 'Other AI assistants and datasets.',
    agents: [
      'DuckAssistBot',
      'Amazonbot',
      'Meta-ExternalAgent',
      'Meta-ExternalFetcher',
      'MistralAI-User',
      'CCBot',
    ],
  },
];

export function robotsTxt(): string {
  const groups = NAMED_CRAWLERS.flatMap(({ note, agents }) => [
    `# ${note}`,
    ...agents.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
  ]);
  return [
    `# robots.txt for ${pageUrl('map')}`,
    '#',
    '# Every page is public and every crawler is welcome: search engines, AI search and answer',
    '# engines, AI training crawlers, and the fetchers people send. Nothing is disallowed.',
    '',
    'User-agent: *',
    'Allow: /',
    '',
    ...groups,
    `Sitemap: ${siteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

/** `date` is the build day, `YYYY-MM-DD`: the pages are rebuilt, and redeployed, together. */
export function sitemapXml(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`sitemap: "${date}" is not YYYY-MM-DD`);
  const urls = SITE_PAGES.map((page) =>
    [
      '  <url>',
      `    <loc>${escapeText(pageUrl(page.id))}</loc>`,
      `    <lastmod>${date}</lastmod>`,
      '  </url>',
    ].join('\n'),
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

const listLink = (text: string, href: string, note: string): string =>
  `- [${escapeMarkdown(text)}](${href}): ${escapeMarkdown(note)}`;

/** llms.txt: a title, a one-paragraph summary, then the pages worth reading, with a line each. */
export function llmsTxt(options: SiteBuildOptions): string {
  const ctx = renderContext(options, true);
  const copy = enSite.llms;
  const href = (link: Parameters<typeof linkTarget>[0]): string => linkTarget(link, true).href;
  return [
    `# ${en.appTitle}`,
    '',
    `> ${escapeMarkdown(copy.summary)}`,
    '',
    ...copy.details.flatMap((detail) => [escapeMarkdown(detail), '']),
    `## ${copy.toolsHeading}`,
    '',
    listLink(copy.links.map, href('map'), paragraphText(enSite.summaries.map, ctx)),
    listLink(copy.links.forge, href('forge'), paragraphText(enSite.summaries.forge, ctx)),
    '',
    `## ${copy.aboutHeading}`,
    '',
    listLink(copy.links.about, href('about'), copy.notes.about),
    listLink(copy.links.privacy, href('privacy'), copy.notes.privacy),
    listLink(copy.links.source, href('source'), copy.notes.source),
    '',
    `## ${copy.optionalHeading}`,
    '',
    listLink(copy.links.llmsFull, href('llmsFull'), copy.notes.llmsFull),
    '',
  ].join('\n');
}

function sectionMarkdown(section: SiteSection, ctx: RenderContext): string {
  return `## ${escapeMarkdown(section.heading)}\n\n${blocksMarkdown(section.blocks, ctx)}`;
}

function questionMarkdown(question: SiteQuestion, ctx: RenderContext): string {
  return `### ${escapeMarkdown(question.question)}\n\n${blocksMarkdown(question.answer, ctx)}`;
}

/** llms-full.txt: the About page, all of it, as one Markdown file. */
export function llmsFullTxt(options: SiteBuildOptions): string {
  const ctx = renderContext(options, true);
  const about = enSite.about;
  const parts = [
    `# ${escapeMarkdown(about.title)}`,
    escapeMarkdown(enSite.llms.fullSource.replace('{url}', pageUrl('about'))),
    blocksMarkdown(about.lead, ctx),
    ...about.sections.map((section) => sectionMarkdown(section, ctx)),
    `## ${escapeMarkdown(about.faqHeading)}`,
    ...about.faq.map((question) => questionMarkdown(question, ctx)),
    escapeMarkdown(en.disclaimer),
  ];
  return `${parts.join('\n\n')}\n`;
}

export interface CrawlFile {
  readonly fileName: string;
  readonly source: string;
}

export function crawlFiles(options: SiteBuildOptions & { readonly date: string }): CrawlFile[] {
  return [
    { fileName: 'robots.txt', source: robotsTxt() },
    { fileName: 'sitemap.xml', source: sitemapXml(options.date) },
    { fileName: 'llms.txt', source: llmsTxt(options) },
    { fileName: 'llms-full.txt', source: llmsFullTxt(options) },
  ];
}
