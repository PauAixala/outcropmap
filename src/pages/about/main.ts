/**
 * Entry point for the About page (about.html): what OutCrop is, how to use it, how accurate it is,
 * and the questions players ask. The text lives in `src/ui/i18n/en-site.ts`.
 *
 * The article is static HTML, written into the page at build time (`src/app/site/pages.ts`), so a
 * crawler that runs no JavaScript reads all of it. This script adds what needs it: the theme and the
 * shared header. No ad slots on this page.
 */
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';

async function boot(): Promise<void> {
  await initTheme();
  const headerEl = document.getElementById('app-header');
  if (headerEl) mountHeader(headerEl, { page: 'about' });
}

void boot();

export {};
