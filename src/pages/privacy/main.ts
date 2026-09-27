/**
 * Entry point for the privacy page (privacy.html): what the site keeps, what it sends, and — only
 * in a build with ads — what Google AdSense does. AdSense's program policies ask for this page, and
 * the ads section follows its required disclosure. The text lives in `src/ui/i18n/en.ts`.
 */
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';
import { en } from '@ui/i18n/en';
import { ADS_ENABLED } from '@app/ads-config';
import { REPOSITORY_URL } from '@app/project';

function section(heading: string, ...body: readonly (string | HTMLElement)[]): HTMLElement {
  const box = document.createElement('section');
  const title = document.createElement('h2');
  title.textContent = heading;
  box.append(title);
  for (const part of body) {
    if (typeof part === 'string') {
      const p = document.createElement('p');
      p.textContent = part;
      box.append(p);
    } else {
      box.append(part);
    }
  }
  return box;
}

function link(href: string, text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  p.append(a);
  return p;
}

async function boot(): Promise<void> {
  await initTheme();
  const headerEl = document.getElementById('app-header');
  if (headerEl) mountHeader(headerEl, { page: 'privacy' });

  const root = document.getElementById('privacy');
  if (!root) return;
  const copy = en.privacy;
  const title = document.createElement('h1');
  title.textContent = copy.title;
  const intro = document.createElement('p');
  intro.className = 'privacy__intro';
  intro.textContent = copy.intro;

  const ads = ADS_ENABLED
    ? section(
        copy.adsHeading,
        copy.ads,
        copy.adsConsent,
        link('https://adssettings.google.com/', copy.adsOptOut),
        link('https://policies.google.com/technologies/partner-sites', copy.adsPartners),
      )
    : section(copy.noAdsHeading, copy.noAds);

  const disclaimer = document.createElement('p');
  disclaimer.className = 'site-disclaimer';
  disclaimer.textContent = en.disclaimer;

  root.replaceChildren(
    title,
    intro,
    section(copy.keptHeading, copy.kept),
    ads,
    section(
      copy.hostingHeading,
      copy.hosting,
      link(
        'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement',
        copy.hostingLink,
      ),
    ),
    section(
      copy.contactHeading,
      copy.contact,
      link(`${REPOSITORY_URL}/issues`, `${REPOSITORY_URL}/issues`),
    ),
    disclaimer,
  );
}

void boot();

export {};
