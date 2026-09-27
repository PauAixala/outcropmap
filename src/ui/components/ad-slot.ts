/**
 * One Google AdSense display unit, and the consent revocation link Google's CMP program requires.
 *
 * Both render nothing unless `ads.config.json` names a publisher ID (and, for a slot, an ad unit for
 * that page), so a build without ads carries no trace of them. The AdSense script itself is not
 * loaded here: the build writes it into every page's head, where AdSense's crawler expects it.
 */
import { ADS, ADS_ENABLED, type AdPage } from '@app/ads-config';
import { en } from '@ui/i18n/en';

interface AdsWindow {
  adsbygoogle?: unknown[];
  googlefc?: { callbackQueue?: unknown[]; showRevocationMessage?: () => void };
}

/** Appends `page`'s ad unit to `container`. Returns whether one was mounted. */
export function mountAdSlot(container: HTMLElement, page: AdPage): boolean {
  const slot = ADS.slots[page];
  if (!ADS_ENABLED || slot === '') return false;

  const box = document.createElement('aside');
  box.className = 'ad-slot';
  box.setAttribute('aria-label', en.ads.label);
  const label = document.createElement('p');
  label.className = 'ad-slot__label';
  label.textContent = en.ads.label;
  const unit = document.createElement('ins');
  unit.className = 'adsbygoogle ad-slot__unit';
  unit.dataset.adClient = ADS.client;
  unit.dataset.adSlot = slot;
  unit.dataset.adFormat = 'auto';
  unit.dataset.fullWidthResponsive = 'true';
  box.append(label, unit);
  container.append(box);

  const w = window as unknown as AdsWindow;
  (w.adsbygoogle = w.adsbygoogle ?? []).push({});
  return true;
}

/**
 * The "Privacy and cookie settings" control: reopens Google's consent message so a visitor can
 * change or withdraw consent (AdSense Help, "Add a consent revocation link to your site").
 * Returns null in a build without ads, where there is no consent to revisit.
 */
export function createCookieSettingsButton(className: string): HTMLButtonElement | null {
  if (!ADS_ENABLED) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = en.ads.cookieSettings;
  button.addEventListener('click', () => {
    const w = window as unknown as AdsWindow;
    const fc = (w.googlefc = w.googlefc ?? {});
    (fc.callbackQueue = fc.callbackQueue ?? []).push(() => w.googlefc?.showRevocationMessage?.());
  });
  return button;
}
