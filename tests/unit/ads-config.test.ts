import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAdsConfig } from '@app/ads-config';

/**
 * `ads.config.json` switches the site's ads on and off. A malformed publisher or ad-unit id must fail
 * here, at test and build time, not reach a page that asks Google for an ad that does not exist.
 */
describe('parseAdsConfig', () => {
  it('accepts the committed file', () => {
    const raw: unknown = JSON.parse(readFileSync('ads.config.json', 'utf8'));
    expect(() => parseAdsConfig(raw)).not.toThrow();
  });

  it('reads a publisher and one ad unit per page', () => {
    const config = parseAdsConfig({
      client: 'ca-pub-1234567890123456',
      slots: { map: '1234567890', forge: '' },
    });
    expect(config).toEqual({
      client: 'ca-pub-1234567890123456',
      slots: { map: '1234567890', forge: '' },
    });
  });

  it('ignores the slots while no publisher is set', () => {
    expect(
      parseAdsConfig({ client: '', slots: { map: '1234567890', forge: '1234567890' } }),
    ).toEqual({
      client: '',
      slots: { map: '', forge: '' },
    });
  });

  it('rejects a malformed publisher id', () => {
    expect(() => parseAdsConfig({ client: 'pub-1234567890123456', slots: {} })).toThrow(/ca-pub-/);
  });

  it('rejects a malformed ad unit id', () => {
    expect(() =>
      parseAdsConfig({ client: 'ca-pub-1234567890123456', slots: { map: 'abc', forge: '' } }),
    ).toThrow(/slots\.map/);
  });
});
