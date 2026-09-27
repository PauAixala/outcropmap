// Shared shell header: app title, a link between the map and forge pages, and a theme toggle.
// Mounted by both src/pages/map/main.ts and src/pages/forge/main.ts.
import { REPOSITORY_URL } from '@app/project';
import { en } from '@ui/i18n/en';
import { createCookieSettingsButton } from '@ui/components/ad-slot';
import { cycleTheme, getThemePreference, onThemeChange } from '@ui/theme/theme';
import type { ThemePreference } from '@ui/theme/theme';

export interface HeaderOptions {
  readonly page: 'map' | 'forge' | 'privacy';
}

function themeLabel(pref: ThemePreference): string {
  return `${en.theme.toggleLabel}: ${en.theme[pref]}`;
}

export function mountHeader(container: HTMLElement, options: HeaderOptions): void {
  container.replaceChildren();
  container.classList.add('app-header');

  const title = document.createElement('span');
  title.className = 'app-header__title';
  title.textContent = options.page === 'forge' ? en.forgeTitle : en.appTitle;

  // Both destinations are always shown, as tabs: one link that says "Forge" gives no hint that the
  // page you are on is the other half of a pair. The current page is drawn pressed in, the other
  // raised, so the pair reads as a switch rather than as a stray link.
  const nav = document.createElement('nav');
  nav.className = 'app-header__nav';
  // Relative paths only (ADR 0004) — the site must work from any subfolder.
  const tabs: readonly { page: 'map' | 'forge'; href: string; label: string }[] = [
    { page: 'map', href: './index.html', label: en.nav.map },
    { page: 'forge', href: './forge.html', label: en.nav.forge },
  ];
  for (const tab of tabs) {
    const link = document.createElement('a');
    link.className = 'app-tab';
    link.href = tab.href;
    link.textContent = tab.label;
    if (tab.page === options.page) {
      link.dataset.current = 'true';
      // The tab you are on is not a link anywhere; marking it tells assistive tech the same thing
      // the bevel tells everyone else.
      link.setAttribute('aria-current', 'page');
    }
    nav.append(link);
  }

  // Full screen. The Fullscreen API is the only way to get the browser chrome out of the way of a
  // map, and a map is what this app mostly is.
  const fullscreenButton = document.createElement('button');
  fullscreenButton.type = 'button';
  fullscreenButton.className = 'app-header__button';
  const syncFullscreenLabel = (): void => {
    fullscreenButton.textContent = document.fullscreenElement
      ? en.nav.exitFullscreen
      : en.nav.fullscreen;
  };
  syncFullscreenLabel();
  fullscreenButton.addEventListener('click', () => {
    // Both calls reject when the browser refuses (an iframe without the permission, a user gesture
    // it did not like). Nothing to recover, so swallow rather than throw into the console.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', syncFullscreenLabel);

  const themeButton = document.createElement('button');
  themeButton.type = 'button';
  themeButton.className = 'app-header__button app-header__theme-toggle';
  themeButton.textContent = themeLabel(getThemePreference());
  themeButton.addEventListener('click', () => {
    themeButton.textContent = themeLabel(cycleTheme());
  });
  onThemeChange((_tokens, pref) => {
    themeButton.textContent = themeLabel(pref);
  });

  // EUPL-1.2 art. 5 asks that the licence notice stay visible, and art. 3 that whoever receives the
  // work can reach its source. One line in the header does both.
  const legal = document.createElement('a');
  legal.className = 'app-header__legal';
  legal.href = REPOSITORY_URL;
  legal.target = '_blank';
  legal.rel = 'noopener noreferrer';
  legal.textContent = en.nav.licence;

  // The privacy page, and — only when the site shows ads — Google's consent revocation link.
  const privacy = document.createElement('a');
  privacy.className = 'app-header__legal';
  privacy.href = './privacy.html';
  privacy.textContent = en.nav.privacy;
  if (options.page === 'privacy') privacy.setAttribute('aria-current', 'page');
  const cookieSettings = createCookieSettingsButton('app-header__legal app-header__cookies');

  container.append(title, nav, legal, privacy);
  if (cookieSettings) container.append(cookieSettings);
  container.append(fullscreenButton, themeButton);
}
