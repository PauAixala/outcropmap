import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { llmsFullTxt, llmsTxt } from '@app/site/crawl-files';
import { adsState, pageDescription, renderSitePage, type SiteBuildOptions } from '@app/site/pages';
import { SITE_PAGES } from '@app/site/site';
import { en } from '@ui/i18n/en';
import { enSite, type AdsState, type Block } from '@ui/i18n/en-site';

/**
 * What the site says about its ads, in each state ads.config.json can put a build in (`AdsState`).
 *
 * Before AdSense approves the site (`approved: false`) the pages carry its tag and Google's consent
 * message but draw no ad, so nothing a visitor or a crawler reads may say the site shows ads, while
 * the privacy page still discloses everything that loads. Once it is approved the text is what it
 * was before the switch existed: the sentences quoted below are that wording, so a deliberate
 * change to it is made here too. Without AdSense at all, the text says there are no ads.
 */
const ROOT = process.cwd();
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

const BUILDS: Readonly<Record<AdsState, SiteBuildOptions>> = {
  noAds: { adsEnabled: false },
  adsPending: { adsEnabled: true, adsApproved: false },
  ads: { adsEnabled: true, adsApproved: true },
};

const unescape = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The text a reader sees: no tags, no scripts, entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?a\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ');
  return unescape(text).replace(/\s+/g, ' ').trim();
}

const page = (file: string, state: AdsState): string =>
  renderSitePage(file, read(file), BUILDS[state]);

/**
 * Everything a build writes for its readers: every page whole, so its description, social card
 * and structured data count as much as its body, and llms.txt and llms-full.txt.
 */
function everything(options: SiteBuildOptions): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const { file } of SITE_PAGES)
    files.set(file, unescape(renderSitePage(file, read(file), options)));
  files.set('llms.txt', llmsTxt(options));
  files.set('llms-full.txt', llmsFullTxt(options));
  return files;
}

/** Wording that says, or takes for granted, that the site shows ads now. */
const CLAIMS: readonly RegExp[] = [
  /\b(?:shows|carries|has|serves|displays) ads\b/i,
  /\bads (?:served|shown) by\b/i,
  /\bwhat the ads do\b/i,
  /\bthe Google AdSense ads\b/i,
  /\b(?:ad-supported|supported by ads|funded by ads)\b/i,
];

const claims = (text: string): string[] =>
  CLAIMS.flatMap((claim) => {
    const match = claim.exec(text);
    return match ? [match[0]] : [];
  });

describe('what the site says about its ads', () => {
  const pending = everything(BUILDS.adsPending);
  const approved = everything(BUILDS.ads);

  it('maps ads.config.json onto three states', () => {
    expect(adsState({ adsEnabled: false, adsApproved: true })).toBe('noAds');
    expect(adsState({ adsEnabled: false, adsApproved: false })).toBe('noAds');
    expect(adsState({ adsEnabled: true, adsApproved: false })).toBe('adsPending');
    expect(adsState({ adsEnabled: true, adsApproved: true })).toBe('ads');
  });

  it('never says the site shows ads before AdSense approves it', () => {
    expect([...pending.keys()].length).toBe(SITE_PAGES.length + 2);
    for (const [file, text] of pending) expect([file, claims(text)]).toEqual([file, []]);
  });

  it('would catch the approved wording, so the check above means something', () => {
    expect(claims(approved.get('about.html') ?? '')).toEqual(['shows ads']);
    expect(claims(approved.get('privacy.html') ?? '')).toEqual([
      'shows ads',
      'ads served by',
      'what the ads do',
      'the Google AdSense ads',
    ]);
    expect(claims(approved.get('llms-full.txt') ?? '')).toEqual(['shows ads']);
  });

  it('says, before approval, that the code is there and the ads come once AdSense approves', () => {
    /** The About page's paragraphs for before approval: its privacy section's and its FAQ's. */
    const pendingParagraphs = (blocks: readonly Block[]): string[] =>
      blocks.flatMap((block) =>
        'p' in block && block.when === 'adsPending'
          ? [block.p.map((part) => (typeof part === 'string' ? part : part.text)).join('')]
          : [],
      );
    const privacy = enSite.about.sections.find((section) => section.id === 'privacy');
    const free = enSite.about.faq.find((question) => question.id === 'free');
    const [inPrivacy, inFree] = [privacy?.blocks ?? [], free?.answer ?? []].map(pendingParagraphs);
    expect([inPrivacy?.length, inFree?.length]).toEqual([1, 1]);
    const about = pending.get('about.html') ?? '';
    const jsonLd =
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(about)?.[1] ?? '';
    for (const text of [...(inPrivacy ?? []), ...(inFree ?? [])]) {
      expect(text).toMatch(/once AdSense approves it; until then it shows none\./);
      expect(visibleText(about)).toContain(text);
      expect(pending.get('llms-full.txt')).toContain(text);
    }
    expect(inPrivacy?.[0]).toContain('Google AdSense’s code and Google’s consent message');
    // The FAQPage answer in the structured data says the same as the page.
    expect(jsonLd).toContain(inFree?.[0] ?? '(missing)');
    expect(pageDescription('privacy', BUILDS.adsPending)).toBe(
      enSite.pages.privacy.descriptionAdsPending,
    );
  });

  it('discloses on the privacy page, before approval and after, the tag, its cookies, the consent message and how to change the choice', () => {
    for (const state of ['adsPending', 'ads'] as const) {
      const html = page('privacy.html', state);
      const text = visibleText(html);
      for (const fact of [
        'Google AdSense',
        'cookies',
        'consent',
        'the European Economic Area, the United Kingdom and Switzerland',
        'You can change that choice at any time with “Privacy and cookie settings”, at the top of the Map, Forge, Guides and About pages.',
        // AdSense's required disclosure, word for word.
        'Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites.',
        'Google’s use of advertising cookies enables it and its partners to serve ads based on your visits to this and other sites on the Internet.',
        en.privacy.adsOptOut,
        en.privacy.adsPartners,
      ]) {
        expect([state, fact, text.includes(fact)]).toEqual([state, fact, true]);
      }
      expect(html).toContain('href="https://adssettings.google.com/"');
      expect(html).toContain('href="https://policies.google.com/technologies/partner-sites"');
    }
    // What loads before approval: the tag on every other page, its cookies, the US states link.
    const text = visibleText(page('privacy.html', 'adsPending'));
    expect(text).toContain(enSite.privacy.introAdsPending);
    expect(text).toContain('shows no ads yet: they will appear once AdSense approves the site.');
    expect(text).toContain('Its code already loads on every page except this one');
    expect(text).toContain('Google may set cookies through it.');
    expect(text).toContain('“Do Not Sell or Share My Personal Information”');
  });

  it('says the code loads on every page but the privacy page only because the build does that', () => {
    expect(
      SITE_PAGES.filter((sitePage) => !sitePage.adScript).map((sitePage) => sitePage.id),
    ).toEqual(['privacy']);
  });

  it('keeps the approved wording as it was before the switch', () => {
    const about = visibleText(page('about.html', 'ads'));
    expect(about).toContain(
      'The site shows ads from Google AdSense, which uses cookies. Visitors in the European Economic Area, the United Kingdom and Switzerland are asked for consent first.',
    );
    expect(about).toContain(
      'Yes. There is no account and nothing to install, and the source code is open under the EUPL-1.2. The site shows ads from Google AdSense.',
    );
    const privacy = visibleText(page('privacy.html', 'ads'));
    expect(privacy).toContain('What OutCrop keeps, what it sends, and what the ads do.');
    expect(privacy).toContain(
      'This site shows ads served by Google AdSense. Third-party vendors, including Google, use cookies to serve ads based on your prior visits to this website or other websites. Google’s use of advertising cookies enables it and its partners to serve ads based on your visits to this and other sites on the Internet.',
    );
    expect(privacy).toContain(
      'Visitors in the European Economic Area, the United Kingdom and Switzerland are asked for consent before personalised ads are shown. You can change that choice at any time with “Privacy and cookie settings”, at the top of the Map, Forge, Guides and About pages.',
    );
    expect(pageDescription('privacy', BUILDS.ads)).toBe(
      'How OutCrop handles your data: what stays in your browser, what it never sends, and what the Google AdSense ads and their cookies do.',
    );
    // And none of the wording for before approval.
    for (const [file, text] of approved) {
      for (const words of [
        enSite.privacy.adsPending,
        enSite.privacy.introAdsPending,
        enSite.pages.privacy.descriptionAdsPending,
        'until then it shows none',
        'no ads yet',
      ]) {
        expect([file, words, text.includes(words)]).toEqual([file, words, false]);
      }
    }
  });

  it('keeps a build without AdSense as it was, whatever `approved` says', () => {
    const none = everything({ adsEnabled: false, adsApproved: false });
    expect(everything({ adsEnabled: false, adsApproved: true })).toEqual(none);
    for (const [file, text] of none)
      expect([file, text.includes('AdSense')]).toEqual([file, false]);
    expect(visibleText(none.get('about.html') ?? '')).toContain(
      'This copy of OutCrop shows no ads and sets no cookies.',
    );
    expect(visibleText(none.get('privacy.html') ?? '')).toContain(en.privacy.noAds);
    expect(pageDescription('privacy', BUILDS.noAds)).toBe(enSite.pages.privacy.descriptionNoAds);
  });

  it('keeps README.md true in either state', () => {
    const readme = read('README.md');
    const privacy = readme.slice(readme.indexOf('## Privacy'), readme.indexOf('## Not affiliated'));
    expect(privacy).toContain('Ads show only once AdSense has approved the site');
    expect(claims(privacy)).toEqual([]);
    expect(privacy).not.toMatch(/every page\b(?! but)/);
  });
});
