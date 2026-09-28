// Shared shell header: app title, a link between the map and forge pages, and a theme toggle.
// Mounted by every page's entry point (src/pages/*/main.ts).
import { REPOSITORY_URL } from '@app/project';
import { sitePage } from '@app/site/site';
import type { SitePageId } from '@app/site/site';
import { en } from '@ui/i18n/en';
import { createCookieSettingsButton } from '@ui/components/ad-slot';
import { cycleTheme, getThemePreference, onThemeChange } from '@ui/theme/theme';
import type { ThemePreference } from '@ui/theme/theme';

export interface HeaderOptions {
  readonly page: SitePageId;
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

  // The About and privacy pages, and — only when the site shows ads, and only on a page that carries
  // the ad tag — Google's consent revocation link. privacy.html carries no ad tag
  // (src/app/site/site.json), so the button could not open the consent message there.
  const about = document.createElement('a');
  about.className = 'app-header__legal';
  about.href = './about.html';
  about.textContent = en.nav.about;
  if (options.page === 'about') about.setAttribute('aria-current', 'page');
  const privacy = document.createElement('a');
  privacy.className = 'app-header__legal';
  privacy.href = './privacy.html';
  privacy.textContent = en.nav.privacy;
  if (options.page === 'privacy') privacy.setAttribute('aria-current', 'page');
  const cookieSettings = sitePage(options.page).adScript
    ? createCookieSettingsButton('app-header__legal app-header__cookies')
    : null;

  container.append(title, nav, legal, about, privacy);
  if (cookieSettings) container.append(cookieSettings);
  container.append(themeButton);
}
