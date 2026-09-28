/**
 * Entry point for the privacy page (privacy.html): what the site keeps, what it sends, and — only
 * in a build with ads — what Google AdSense does. AdSense's program policies ask for this page, and
 * the ads section follows its required disclosure. The text lives in `src/ui/i18n/en.ts`.
 *
 * The policy itself is static HTML: the build writes it into the page (`src/app/site/pages.ts`,
 * which also decides the ads section from `ads.config.json`), so it reads the same with JavaScript
 * or without, and to a crawler that runs none. This script adds what needs it: the theme and the
 * shared header. The page carries no ad tag (src/app/site/site.json), and the header leaves out the
 * cookie-settings button accordingly.
 */
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';

async function boot(): Promise<void> {
  await initTheme();
  const headerEl = document.getElementById('app-header');
  if (headerEl) mountHeader(headerEl, { page: 'privacy' });
}

void boot();

export {};
