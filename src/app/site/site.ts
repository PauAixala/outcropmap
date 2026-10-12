/**
 * The site's pages and its public address, from `site.json`, typed.
 *
 * vite.config.ts loads this module at build time, and Vite's config loader does not resolve the
 * aliases the config itself defines, so this file and everything under `src/app/site/` import by
 * relative path only (tests/unit/site-imports.test.ts holds that line).
 */
import site from './site.json';

/**
 * The guides, in the order the guides page lists them. Each is a page of its own at the site root;
 * `src/app/site/guides.ts` writes its text and tables from `src/ui/i18n/en-guides.ts` and the data
 * the map and the forge run on.
 */
export const GUIDE_IDS = [
  'tfg-ore-veins',
  'tfc-ore-veins',
  'kaolin-clay',
  'rock-layers',
  'anvil-guide',
  'tfg-structures',
  'tfg-dimensions',
] as const;
export type GuideId = (typeof GUIDE_IDS)[number];

export const SITE_PAGE_IDS = ['map', 'forge', 'guides', ...GUIDE_IDS, 'about', 'privacy'] as const;
export type SitePageId = (typeof SITE_PAGE_IDS)[number];

export const isSitePageId = (id: string): id is SitePageId =>
  (SITE_PAGE_IDS as readonly string[]).includes(id);

export const isGuideId = (id: string): id is GuideId => (GUIDE_IDS as readonly string[]).includes(id);

export interface SitePage {
  readonly id: SitePageId;
  /** The HTML file at the site root, e.g. `forge.html`. */
  readonly file: string;
  /** Where it lives on the site, e.g. `/forge.html`; the map is `/`. */
  readonly path: string;
  /** Whether the page carries the AdSense tag (`site.json` says why privacy.html does not). */
  readonly adScript: boolean;
}

/** `https://outcropmap.com`: scheme and host, no trailing slash. */
export const SITE_ORIGIN: string = site.origin;

export const SITE_PAGES: readonly SitePage[] = site.pages.map((page) => {
  if (!isSitePageId(page.id)) throw new Error(`src/app/site/site.json: unknown page id "${page.id}"`);
  return { id: page.id, file: page.file, path: page.path, adScript: page.adScript };
});

export function sitePage(id: SitePageId): SitePage {
  const page = SITE_PAGES.find((candidate) => candidate.id === id);
  if (page === undefined) throw new Error(`src/app/site/site.json lists no "${id}" page`);
  return page;
}

/** The page built from `file` (`forge.html`), or `undefined` for a file that is not a site page. */
export function sitePageByFile(file: string): SitePage | undefined {
  return SITE_PAGES.find((page) => page.file === file);
}

/** The page's canonical, absolute address: `https://outcropmap.com/forge.html`. */
export function pageUrl(id: SitePageId): string {
  return `${SITE_ORIGIN}${sitePage(id).path}`;
}

/** The link to a page from another page of the site: relative, so the site works from any folder. */
export function pageHref(id: SitePageId): string {
  return `./${sitePage(id).file}`;
}

/** The absolute address of anything at the site root, e.g. `siteUrl('/sitemap.xml')`. */
export function siteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** The social-card image (`public/og-image.jpg`), absolute because Open Graph requires it. */
export const SOCIAL_IMAGE = {
  url: siteUrl(site.socialImage.path),
  width: site.socialImage.width,
  height: site.socialImage.height,
  type: site.socialImage.type,
} as const;
