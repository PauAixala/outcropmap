/**
 * The site's advertising settings, read once from `ads.config.json` at the repository root.
 *
 * Ads are off unless a publisher ID is set there. The same file drives the build (the AdSense tag
 * in every page's head, `ads.txt`, and the one remote script `build:web` then allows) and the pages
 * (the ad slots, the "Privacy and cookie settings" link and the privacy page's ads section), so the
 * two can never disagree.
 */
import rawConfig from '../../ads.config.json';

/**
 * Where an ad can go. The map has a rail to the left of the map and a banner below it; the forge
 * has a rail on each side, one block between the calculator and the custom-recipe tools, and one
 * block at the end of the page.
 */
export const AD_PLACEMENTS = [
  'mapLeft',
  'mapBottom',
  'forgeLeft',
  'forgeRight',
  'forgeMiddle',
  'forgeEnd',
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export interface AdsConfig {
  /** `ca-pub-` and 16 digits, or empty for a build without ads. */
  readonly client: string;
  /** One display ad unit per placement; empty means no ad there. */
  readonly slots: Readonly<Record<AdPlacement, string>>;
}

const CLIENT = /^ca-pub-\d{16}$/;
const SLOT = /^\d{6,}$/;

/**
 * Validates the raw file. A malformed ID fails loudly here, at build and test time, rather than
 * shipping a page that asks Google for an ad unit that does not exist.
 */
export function parseAdsConfig(raw: unknown): AdsConfig {
  const record = (raw ?? {}) as { client?: unknown; slots?: Partial<Record<string, unknown>> };
  const client = typeof record.client === 'string' ? record.client.trim() : '';
  if (client !== '' && !CLIENT.test(client)) {
    throw new Error(`ads.config.json: client "${client}" is not "ca-pub-" followed by 16 digits`);
  }
  const slots = {} as Record<AdPlacement, string>;
  for (const placement of AD_PLACEMENTS) {
    const value = record.slots?.[placement];
    const text = typeof value === 'string' ? value.trim() : '';
    if (text !== '' && !SLOT.test(text)) {
      throw new Error(`ads.config.json: slots.${placement} "${text}" is not a numeric ad unit id`);
    }
    slots[placement] = client === '' ? '' : text;
  }
  return { client, slots };
}

export const ADS: AdsConfig = parseAdsConfig(rawConfig);

/** Whether this build shows ads at all. */
export const ADS_ENABLED = ADS.client !== '';
