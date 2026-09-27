/**
 * Google AdSense display units, and the consent revocation link Google's CMP program requires.
 *
 * Everything here renders nothing unless `ads.config.json` names a publisher ID and an ad unit for
 * the placement, so a build without ads carries no trace of them. The AdSense script itself is not
 * loaded here: the build writes it into every page's head, where AdSense's crawler expects it.
 */
import { ADS, ADS_ENABLED, type AdPlacement } from '@app/ads-config';
import { en } from '@ui/i18n/en';

interface AdsWindow {
  adsbygoogle?: unknown[];
  googlefc?: { callbackQueue?: unknown[]; showRevocationMessage?: () => void };
}

/**
 * How each placement is cut: a fixed 160 x 600 skyscraper, a responsive banner, or a responsive
 * block.
 */
type AdShape = 'rail' | 'banner' | 'block';

const SHAPE: Readonly<Record<AdPlacement, AdShape>> = {
  mapLeft: 'rail',
  mapBottom: 'banner',
  forgeLeft: 'rail',
  forgeRight: 'rail',
  forgeMiddle: 'block',
  forgeEnd: 'block',
};

/** The widest rail, plus the room around it; below these widths a rail is not mounted at all. */
export const RAIL_MIN_VIEWPORT: Readonly<Record<'map' | 'forge', number>> = {
  map: 1100,
  forge: 1560,
};

/** Whether `placement` has an ad unit in this build. */
export function hasAd(placement: AdPlacement): boolean {
  return ADS_ENABLED && ADS.slots[placement] !== '';
}

/** Appends `placement`'s ad unit to `container`, which must already be in the page. */
export function mountAdSlot(container: HTMLElement, placement: AdPlacement): boolean {
  if (!hasAd(placement)) return false;
  const shape = SHAPE[placement];

  const box = document.createElement('aside');
  box.className = `ad-slot ad-slot--${shape}`;
  box.setAttribute('aria-label', en.ads.label);
  const label = document.createElement('p');
  label.className = 'ad-slot__label';
  label.textContent = en.ads.label;
  const unit = document.createElement('ins');
  unit.className = 'adsbygoogle ad-slot__unit';
  unit.dataset.adClient = ADS.client;
  unit.dataset.adSlot = ADS.slots[placement];
  if (shape === 'rail') {
    // A fixed 160 x 600 skyscraper: a responsive unit in a narrow column comes back as a stamp.
    unit.style.width = '160px';
    unit.style.height = '600px';
  } else {
    unit.dataset.adFormat = shape === 'banner' ? 'horizontal' : 'auto';
    unit.dataset.fullWidthResponsive = 'true';
  }
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
