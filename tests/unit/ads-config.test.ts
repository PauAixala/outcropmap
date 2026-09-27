import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AD_PLACEMENTS, parseAdsConfig } from '@app/ads-config';

/**
 * `ads.config.json` switches the site's ads on and off. A malformed publisher or ad-unit id must fail
 * here, at test and build time, not reach a page that asks Google for an ad that does not exist.
 */
const EMPTY = Object.fromEntries(AD_PLACEMENTS.map((placement) => [placement, '']));

describe('parseAdsConfig', () => {
  it('accepts the committed file, which names every placement', () => {
    const raw = JSON.parse(readFileSync('ads.config.json', 'utf8')) as { slots: object };
    expect(() => parseAdsConfig(raw)).not.toThrow();
    expect(Object.keys(raw.slots).sort()).toEqual([...AD_PLACEMENTS].sort());
  });

  it('reads a publisher and one ad unit per placement', () => {
    const config = parseAdsConfig({
      client: 'ca-pub-1234567890123456',
      slots: { mapLeft: '1234567890', forgeEnd: '2345678901' },
    });
    expect(config).toEqual({
      client: 'ca-pub-1234567890123456',
      slots: { ...EMPTY, mapLeft: '1234567890', forgeEnd: '2345678901' },
    });
  });

  it('ignores the slots while no publisher is set', () => {
    expect(parseAdsConfig({ client: '', slots: { mapLeft: '1234567890' } })).toEqual({
      client: '',
      slots: EMPTY,
    });
  });

  it('rejects a malformed publisher id', () => {
    expect(() => parseAdsConfig({ client: 'pub-1234567890123456', slots: {} })).toThrow(/ca-pub-/);
  });

  it('rejects a malformed ad unit id', () => {
    expect(() =>
      parseAdsConfig({ client: 'ca-pub-1234567890123456', slots: { mapBottom: 'abc' } }),
    ).toThrow(/slots\.mapBottom/);
  });
});
