import { describe, expect, it } from 'vitest';
import { addCloudflareAnalytics, BEACON_SRC, BEACON_TOKEN, PRIVACY_DISCLOSURE } from '../../tools/cloudflare-analytics.mjs';

describe('Cloudflare Web Analytics build injection', () => {
  it('adds the configured module beacon to every generated page', () => {
    const html = addCloudflareAnalytics('<html><head></head><body></body></html>', 'index.html');
    expect(html).toContain(`src="${BEACON_SRC}"`);
    expect(html).toContain(`"token": "${BEACON_TOKEN}"`);
    expect(html.match(/data-cf-beacon/g)).toHaveLength(1);
  });

  it('adds a disclosure on the privacy page', () => {
    const html = addCloudflareAnalytics('<html><head></head><body><article></article></body></html>', 'privacy.html');
    expect(html).toContain(PRIVACY_DISCLOSURE);
    expect(html.indexOf(PRIVACY_DISCLOSURE)).toBeLessThan(html.indexOf('</article>'));
  });

  it('fails rather than silently duplicate a beacon or omit its insertion point', () => {
    expect(() => addCloudflareAnalytics('<head></head>', 'index.html')).not.toThrow();
    expect(() => addCloudflareAnalytics('<head></head>data-cf-beacon', 'index.html')).toThrow(/already contains/);
    expect(() => addCloudflareAnalytics('<body></body>', 'index.html')).toThrow(/closing <\/head>/);
  });
});
