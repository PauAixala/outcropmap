/**
 * What the build writes into each page so that it can be read without JavaScript: a descriptive
 * title and description, the canonical address, the social card, schema.org structured data, and
 * static text — the whole article on about.html and privacy.html, the hero on forge.html, and on
 * the map and the forge a summary that only shows where scripting is off (base.css,
 * `.static-summary`). vite.config.ts calls `renderSitePage` on every page, in development too.
 *
 * Most AI crawlers, and some search crawlers, fetch the HTML and never run its scripts; to them a
 * page whose every string is drawn by JavaScript is empty. Everything here comes from the same
 * strings the pages show (`src/ui/i18n/en.ts`, `en-site.ts`), so the static text cannot disagree
 * with the app.
 *
 * A page marks where its parts go with `<!-- outcrop:name -->`. A page not in `site.json`, a marker
 * a page does not use, or one it forgot, fails the build rather than ship a half-filled page.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import { en } from '../../ui/i18n/en';
import { enSite } from '../../ui/i18n/en-site';
import type { SiteLink, SiteQuestion, SiteSection } from '../../ui/i18n/en-site';
import { REPOSITORY_URL } from '../project';
import { factPlaceholders, siteFacts } from './facts';
import { blocksHtml, blocksText, escapeAttr, escapeText, paragraphHtml } from './markup';
import type { LinkTarget, RenderContext } from './markup';
import { SITE_ORIGIN, SOCIAL_IMAGE, pageHref, pageUrl, sitePageByFile, siteUrl } from './site';
import type { SitePageId } from './site';

export interface SiteBuildOptions {
  /** Whether this build shows ads (`ADS_ENABLED`, from ads.config.json). */
  readonly adsEnabled: boolean;
}

/** The licence, as SPDX names it. */
export const LICENSE_URL = 'https://spdx.org/licenses/EUPL-1.2.html';
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
// The privacy page's outbound links, as it has always carried them.
const ADS_SETTINGS_URL = 'https://adssettings.google.com/';
const ADS_PARTNERS_URL = 'https://policies.google.com/technologies/partner-sites';
const HOSTING_PRIVACY_URL =
  'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement';
// What OutCrop is about, for structured data: the game and the two projects it serves (NOTICE.md).
const TFC_URL = 'https://github.com/TerraFirmaCraft/TerraFirmaCraft';
const TFG_URL = 'https://github.com/TerraFirmaGreg-Team/Modpack-Modern';

/**
 * Where a link in the site text goes. A page of this site is relative in the HTML (ADR 0004: the
 * site works from any folder) and absolute where the text leaves the site, as in llms.txt.
 */
export function linkTarget(link: SiteLink, absolute: boolean): LinkTarget {
  switch (link) {
    case 'map':
    case 'forge':
    case 'about':
    case 'privacy':
      return { href: absolute ? pageUrl(link) : pageHref(link), external: false };
    case 'llmsFull':
      return { href: absolute ? siteUrl('/llms-full.txt') : './llms-full.txt', external: false };
    case 'source':
      return { href: REPOSITORY_URL, external: true };
    case 'issues':
      return { href: ISSUES_URL, external: true };
  }
}

let placeholders: Readonly<Record<string, string>> | null = null;

export function renderContext(options: SiteBuildOptions, absolute: boolean): RenderContext {
  placeholders ??= factPlaceholders(siteFacts());
  return {
    values: placeholders,
    ads: options.adsEnabled,
    resolve: (link) => linkTarget(link, absolute),
  };
}

export function pageTitle(id: SitePageId): string {
  return en.pageTitles[id];
}

export function pageDescription(id: SitePageId, options: SiteBuildOptions): string {
  if (id === 'privacy') {
    return options.adsEnabled
      ? enSite.pages.privacy.description
      : enSite.pages.privacy.descriptionNoAds;
  }
  return enSite.pages[id].description;
}

// --- Structured data (schema.org JSON-LD) ---

export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
type JsonObject = { readonly [key: string]: Json };

const ref = (id: string): JsonObject => ({ '@id': id });
const websiteId = `${SITE_ORIGIN}/#website`;
const sourceId = `${SITE_ORIGIN}/#source`;
const appId = (tool: 'map' | 'forge'): string => `${pageUrl(tool)}#app`;
const webPageId = (id: SitePageId): string => `${pageUrl(id)}#webpage`;

function websiteNode(): JsonObject {
  return {
    '@type': 'WebSite',
    '@id': websiteId,
    url: pageUrl('map'),
    name: en.appTitle,
    alternateName: SITE_ORIGIN.replace(/^https?:\/\//, ''),
    description: enSite.llms.summary,
    inLanguage: 'en',
  };
}

function sourceNode(): JsonObject {
  return {
    '@type': 'SoftwareSourceCode',
    '@id': sourceId,
    name: en.appTitle,
    url: REPOSITORY_URL,
    codeRepository: REPOSITORY_URL,
    license: LICENSE_URL,
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Web browser',
    targetProduct: [ref(appId('map')), ref(appId('forge'))],
  };
}

function appNode(tool: 'map' | 'forge'): JsonObject {
  const text = enSite.structuredData[tool];
  return {
    '@type': 'WebApplication',
    '@id': appId(tool),
    name: text.name,
    url: pageUrl(tool),
    description: enSite.pages[tool].description,
    image: SOCIAL_IMAGE.url,
    applicationCategory: 'UtilitiesApplication',
    applicationSubCategory: enSite.structuredData.subCategory,
    operatingSystem: enSite.structuredData.operatingSystem,
    browserRequirements: enSite.structuredData.browserRequirements,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    license: LICENSE_URL,
    featureList: [...text.features],
    keywords: text.keywords.join(', '),
    inLanguage: 'en',
    about: [
      { '@type': 'VideoGame', name: 'Minecraft' },
      { '@type': 'Thing', name: 'TerraFirmaCraft', sameAs: TFC_URL },
      { '@type': 'Thing', name: 'TerraFirmaGreg', sameAs: TFG_URL },
    ],
    isBasedOn: ref(sourceId),
    isPartOf: ref(websiteId),
  };
}

function questionNode(question: SiteQuestion, ctx: RenderContext): JsonObject {
  return {
    '@type': 'Question',
    name: question.question,
    acceptedAnswer: { '@type': 'Answer', text: blocksText(question.answer, ctx) },
  };
}

function webPageNode(id: SitePageId, options: SiteBuildOptions): JsonObject {
  const common = {
    '@id': webPageId(id),
    url: pageUrl(id),
    name: pageTitle(id),
    description: pageDescription(id, options),
    inLanguage: 'en',
    isPartOf: ref(websiteId),
  };
  switch (id) {
    case 'map':
    case 'forge':
      return { '@type': 'WebPage', ...common, mainEntity: ref(appId(id)) };
    case 'about':
      // Google's rule for FAQPage: every question is on the page, visibly. They are — the About
      // page renders the same list (`aboutArticleHtml`), and finish-web-build.mjs checks it.
      return {
        '@type': ['AboutPage', 'FAQPage'],
        ...common,
        about: [ref(appId('map')), ref(appId('forge'))],
        mainEntity: enSite.about.faq.map((question) =>
          questionNode(question, renderContext(options, true)),
        ),
      };
    case 'privacy':
      return { '@type': 'WebPage', ...common };
  }
}

/** The page's schema.org graph: the site, the page, and the tools it is about. */
export function structuredData(id: SitePageId, options: SiteBuildOptions): JsonObject {
  const nodes: JsonObject[] = [websiteNode(), webPageNode(id, options)];
  if (id === 'map' || id === 'forge') nodes.push(appNode(id), sourceNode());
  if (id === 'about') nodes.push(appNode('map'), appNode('forge'), sourceNode());
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** JSON for inside a `<script>`: `<` escaped, so no string in it can close the element. */
export function jsonForScript(value: Json): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// --- <head> ---

function meta(key: 'name' | 'property', name: string, content: string): string {
  return `<meta ${key}="${name}" content="${escapeAttr(content)}" />`;
}

/**
 * Description, canonical address, Open Graph and Twitter card, and the structured data. The three
 * URLs a card needs absolute (`canonical`, `og:url`, `og:image`/`twitter:image`) are the only
 * absolute URLs in the page; finish-web-build.mjs allows exactly those, on this site's origin.
 */
export function headHtml(id: SitePageId, options: SiteBuildOptions): string {
  const url = pageUrl(id);
  const title = pageTitle(id);
  const description = pageDescription(id, options);
  return [
    meta('name', 'description', description),
    `<link rel="canonical" href="${escapeAttr(url)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', en.appTitle),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', SOCIAL_IMAGE.url),
    meta('property', 'og:image:type', SOCIAL_IMAGE.type),
    meta('property', 'og:image:width', String(SOCIAL_IMAGE.width)),
    meta('property', 'og:image:height', String(SOCIAL_IMAGE.height)),
    meta('property', 'og:image:alt', enSite.socialImageAlt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', SOCIAL_IMAGE.url),
    meta('name', 'twitter:image:alt', enSite.socialImageAlt),
    `<script type="application/ld+json">${jsonForScript(structuredData(id, options))}</script>`,
  ].join('\n');
}

// --- <body> ---

const link = (target: LinkTarget, text: string): string =>
  `<a href="${escapeAttr(target.href)}"${
    target.external ? ' target="_blank" rel="noopener noreferrer"' : ''
  }>${escapeText(text)}</a>`;

/**
 * The map's and the forge's text for a visitor without JavaScript: the About page's summary of the
 * tool, word for word, what the page needs, and where to read more. Hidden by base.css unless
 * scripting is off, so a visitor with JavaScript sees the page exactly as before.
 */
export function staticSummaryHtml(tool: 'map' | 'forge', options: SiteBuildOptions): string {
  const ctx = renderContext(options, false);
  const copy = enSite.noScript;
  // The map has no other heading; the forge's hero already holds its <h1>.
  const heading = tool === 'map' ? 'h1' : 'h2';
  const other = tool === 'map' ? 'forge' : 'map';
  const links = [
    link(ctx.resolve(other), copy.links[other]),
    link(ctx.resolve('about'), copy.links.about),
    link(ctx.resolve('privacy'), copy.links.privacy),
    link(ctx.resolve('source'), copy.links.source),
  ];
  return [
    `<section class="static-summary">`,
    `<${heading}>${escapeText(copy[tool].heading)}</${heading}>`,
    `<p>${paragraphHtml(enSite.summaries[tool], ctx)}</p>`,
    `<p>${escapeText(copy[tool].needsScript)}</p>`,
    `<p>${escapeText(copy.more)} ${links.join(' · ')}</p>`,
    `<p class="site-disclaimer">${escapeText(en.disclaimer)}</p>`,
    `</section>`,
  ].join('\n');
}

function sectionHtml(section: SiteSection, ctx: RenderContext): string {
  return [
    `<section id="${escapeAttr(section.id)}">`,
    `<h2>${escapeText(section.heading)}</h2>`,
    blocksHtml(section.blocks, ctx),
    `</section>`,
  ].join('\n');
}

function questionHtml(question: SiteQuestion, ctx: RenderContext): string {
  return [
    `<section id="faq-${escapeAttr(question.id)}" class="about__question">`,
    `<h3>${escapeText(question.question)}</h3>`,
    blocksHtml(question.answer, ctx),
    `</section>`,
  ].join('\n');
}

/** about.html's article: everything on the page is here, as static HTML. */
export function aboutArticleHtml(options: SiteBuildOptions): string {
  const ctx = renderContext(options, false);
  const about = enSite.about;
  const contents = [
    ...about.sections.map((section) => [section.id, section.heading] as const),
    ['faq', about.faqHeading] as const,
  ];
  return [
    `<h1>${escapeText(about.title)}</h1>`,
    `<div class="about__lead">`,
    blocksHtml(about.lead, ctx),
    `</div>`,
    `<nav class="about__contents" aria-label="${escapeAttr(about.contentsLabel)}">`,
    `<ul>${contents.map(([id, heading]) => `<li><a href="#${escapeAttr(id)}">${escapeText(heading)}</a></li>`).join('')}</ul>`,
    `</nav>`,
    ...about.sections.map((section) => sectionHtml(section, ctx)),
    `<section id="faq" class="about__faq">`,
    `<h2>${escapeText(about.faqHeading)}</h2>`,
    ...about.faq.map((question) => questionHtml(question, ctx)),
    `</section>`,
    `<p class="site-disclaimer">${escapeText(en.disclaimer)}</p>`,
  ].join('\n');
}

/**
 * privacy.html's article, from `en.privacy`. The ads section follows `ads.config.json`, decided at
 * build time exactly as the pages' ad tag is.
 */
export function privacyArticleHtml(options: SiteBuildOptions): string {
  const copy = en.privacy;
  const p = (text: string): string => `<p>${escapeText(text)}</p>`;
  const out = (href: string, text: string): string =>
    `<p>${link({ href, external: true }, text)}</p>`;
  const section = (heading: string, ...body: readonly string[]): string =>
    [`<section>`, `<h2>${escapeText(heading)}</h2>`, ...body, `</section>`].join('\n');
  const ads = options.adsEnabled
    ? section(
        copy.adsHeading,
        p(copy.ads),
        p(copy.adsConsent),
        out(ADS_SETTINGS_URL, copy.adsOptOut),
        out(ADS_PARTNERS_URL, copy.adsPartners),
      )
    : section(copy.noAdsHeading, p(copy.noAds));
  return [
    `<h1>${escapeText(copy.title)}</h1>`,
    `<p class="privacy__intro">${escapeText(copy.intro)}</p>`,
    section(copy.keptHeading, p(copy.kept)),
    ads,
    section(copy.hostingHeading, p(copy.hosting), out(HOSTING_PRIVACY_URL, copy.hostingLink)),
    section(copy.contactHeading, p(copy.contact), out(ISSUES_URL, ISSUES_URL)),
    `<p class="site-disclaimer">${escapeText(en.disclaimer)}</p>`,
  ].join('\n');
}

/** What each page's `<!-- outcrop:name -->` markers are replaced with. */
export function pageParts(
  id: SitePageId,
  options: SiteBuildOptions,
): Readonly<Record<string, string>> {
  const head = headHtml(id, options);
  switch (id) {
    case 'map':
      return { head, 'static-summary': staticSummaryHtml('map', options) };
    case 'forge':
      // The same strings src/pages/forge/main.ts sets, so the hero reads the same before it runs.
      return {
        head,
        'forge-hero-title': escapeText(en.forge.heroTitle),
        'forge-hero-body': escapeText(en.forge.heroBody),
        'static-summary': staticSummaryHtml('forge', options),
      };
    case 'about':
      return { head, about: aboutArticleHtml(options) };
    case 'privacy':
      return { head, privacy: privacyArticleHtml(options) };
  }
}

const MARKER = /<!--\s*outcrop:([a-z-]+)\s*-->/g;
const TITLE = /<title>[^<]*<\/title>/;

/** Indents every line after the first to the column of the line the marker sits on. */
function indentLike(html: string, offset: number, fill: string): string {
  const lineStart = html.lastIndexOf('\n', offset) + 1;
  const indent = /^[ \t]*/.exec(html.slice(lineStart, offset))?.[0] ?? '';
  return fill.split('\n').join(`\n${indent}`);
}

/**
 * One page, as Vite reads it from disk (`file` is its name at the site root), with its title,
 * metadata and static text written in.
 */
export function renderSitePage(file: string, html: string, options: SiteBuildOptions): string {
  const page = sitePageByFile(file);
  if (page === undefined) {
    throw new Error(`${file} is not a page in src/app/site/site.json; add it there first`);
  }
  if (!TITLE.test(html)) throw new Error(`${file} has no <title> for the build to fill`);
  const parts = pageParts(page.id, options);
  const used = new Set<string>();
  const filled = html
    .replace(TITLE, () => `<title>${escapeText(pageTitle(page.id))}</title>`)
    .replace(MARKER, (_marker, name: string, offset: number, whole: string) => {
      const part = parts[name];
      if (part === undefined)
        throw new Error(`${file}: <!-- outcrop:${name} --> is not one of its parts`);
      used.add(name);
      return indentLike(whole, offset, part);
    });
  const missing = Object.keys(parts).filter((name) => !used.has(name));
  if (missing.length > 0) {
    throw new Error(
      `${file} lacks ${missing.map((name) => `<!-- outcrop:${name} -->`).join(', ')}`,
    );
  }
  return filled;
}
