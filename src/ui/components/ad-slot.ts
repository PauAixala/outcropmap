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
 * How each placement is cut: a fixed 160 x 600 skyscraper, a fixed-size banner as wide as its
 * container allows, or a responsive block.
 */
type AdShape = 'rail' | 'banner' | 'block';

type AdSize = readonly [width: number, height: number];

/** A responsive unit in a narrow column comes back as a stamp, so the rail is always this. */
const RAIL_SIZE: AdSize = [160, 600];

/**
 * The banner's standard sizes, widest first; it takes the widest that fits its container.
 *
 * A fixed size, not a responsive unit, because the banner sits in the map's one-screen layout. A
 * responsive unit there sized itself to the window (390 x 390 on a phone) and wrote
 * `height: auto !important` on every ancestor up to `#app`, which let the page grow to the side
 * panel's whole length and the map with it. The fixed rail never touched its ancestors. Setting
 * an exact size is a modification AdSense permits ("How to modify your responsive ad code",
 * AdSense Help 9183363).
 */
const BANNER_SIZES: readonly AdSize[] = [
  [970, 90],
  [728, 90],
  [468, 60],
  [320, 50],
];

/** The width `container` leaves its content: its inner width less its horizontal padding. */
function contentWidth(container: HTMLElement): number {
  const style = getComputedStyle(container);
  return container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

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

/**
 * Appends `placement`'s ad unit to `container`, which must already be in the page and laid out
 * where it will stay: a banner is sized from the room it has. Returns false, adding nothing, when
 * there is no unit for the placement or a banner has no standard size that fits.
 */
export function mountAdSlot(container: HTMLElement, placement: AdPlacement): boolean {
  if (!hasAd(placement)) return false;
  const shape = SHAPE[placement];
  let size: AdSize | undefined;
  if (shape === 'rail') {
    size = RAIL_SIZE;
  } else if (shape === 'banner') {
    const room = contentWidth(container);
    size = BANNER_SIZES.find(([width]) => width <= room);
    if (size === undefined) return false;
  }

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
  if (size !== undefined) {
    unit.style.width = `${size[0]}px`;
    unit.style.height = `${size[1]}px`;
    // Without this, AdSense still stretches a sized unit across a phone's whole width: a 320 x 50
    // banner came back 390 x 390 ("How to use responsive ad tag parameters", AdSense Help 9183460).
    unit.dataset.fullWidthResponsive = 'false';
  } else {
    unit.dataset.adFormat = 'auto';
    unit.dataset.fullWidthResponsive = 'true';
  }
  box.append(label, unit);
  container.append(box);

  const w = window as unknown as AdsWindow;
  // Once AdSense's script has loaded, `push` runs at once and throws a `TagError` for a slot it
  // refuses ("No slot size for availableWidth=83"); before that it only queues. Uncaught, that
  // error ended the map page's boot on every window under 1100px: no map, no panel, no scale bar.
  // An ad must never take the page down with it, so a refused unit is simply left empty.
  try {
    (w.adsbygoogle = w.adsbygoogle ?? []).push({});
  } catch {
    // Nothing to recover: the box stays in place, empty, and the page carries on.
  }
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
