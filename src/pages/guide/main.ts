/**
 * Entry point for the guides: guides.html and every guide it lists (src/app/site/site.ts's
 * `GUIDE_IDS`). Which page this is comes from the `data-page` attribute its HTML carries.
 *
 * The article is static HTML, written into the page at build time (`src/app/site/guides.ts`), so a
 * visitor and a crawler that runs no JavaScript read all of it, tables included. This script only
 * adds what needs it: the theme, the shared header, a filter box over each long table, and the ads
 * in a build that has them.
 */
import { initTheme } from '@ui/theme/theme';
import { mountHeader } from '@ui/components/header';
import { RAIL_MIN_VIEWPORT, hasAd, mountAdSlot } from '@ui/components/ad-slot';
import type { AdPlacement } from '@app/ads-config';
import { isSitePageId } from '@app/site/site';
import { en } from '@ui/i18n/en';

/** Below this many rows a table is read at a glance, and a filter box is clutter. */
const FILTER_MIN_ROWS = 12;

/**
 * A filter box above each table the build marked `data-filterable`: it hides the rows whose text
 * does not contain what was typed. The rows stay in the page; the filter only changes what shows.
 */
function addTableFilters(root: ParentNode): void {
  for (const wrapper of root.querySelectorAll<HTMLElement>('.guide-table[data-filterable]')) {
    const rows = [...wrapper.querySelectorAll<HTMLTableRowElement>('tbody tr')];
    if (rows.length < FILTER_MIN_ROWS) continue;
    const texts = rows.map((row) => (row.textContent ?? '').toLowerCase());

    const label = document.createElement('label');
    label.className = 'guide-filter';
    const caption = document.createElement('span');
    caption.className = 'guide-filter__label';
    caption.textContent = en.guides.tableFilterLabel;
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'guide-filter__input';
    input.placeholder = en.guides.tableFilterPlaceholder;
    input.autocomplete = 'off';
    const count = document.createElement('span');
    count.className = 'guide-filter__count';
    count.setAttribute('aria-live', 'polite');
    label.append(caption, input, count);

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      let shown = 0;
      rows.forEach((row, index) => {
        const match = query === '' || (texts[index] ?? '').includes(query);
        row.hidden = !match;
        if (match) shown++;
      });
      count.textContent =
        query === ''
          ? ''
          : en.guides.tableFilterCount
              .replace('{shown}', String(shown))
              .replace('{total}', String(rows.length));
    });
    wrapper.before(label);
  }
}

/** A labelled ad block in the article, `where` the anchor says; nothing when it has no unit. */
function mountBlock(anchor: Element | null, where: 'before' | 'after', placement: AdPlacement): void {
  if (anchor === null || !hasAd(placement)) return;
  const box = document.createElement('div');
  box.className = 'guide-ad';
  if (where === 'before') anchor.before(box);
  else anchor.after(box);
  mountAdSlot(box, placement);
}

/**
 * Ads, in a build that has them, placed the way the forge places its own: in a guide, one block
 * after the contents, where the reading starts, and one at the end, before the related guides; on
 * the guides page only the closing one, so the list of guides stays at the top. On a screen wide
 * enough, a rail on each side of the column follows the scroll.
 */
function mountGuideAds(article: HTMLElement): void {
  mountBlock(article.querySelector('.guide__contents'), 'after', 'guideTop');
  const end = article.querySelector('.guide__related') ?? article.querySelector('.guide__source');
  mountBlock(end, 'before', 'guideEnd');

  const mainEl = document.querySelector('.app-main');
  const wide = window.matchMedia(`(min-width: ${RAIL_MIN_VIEWPORT.guide}px)`).matches;
  if (!(mainEl instanceof HTMLElement) || !wide || !(hasAd('guideLeft') || hasAd('guideRight'))) return;
  const layout = document.createElement('div');
  layout.className = 'guide-layout';
  const left = document.createElement('div');
  left.className = 'guide-rail guide-rail--left';
  const right = document.createElement('div');
  right.className = 'guide-rail guide-rail--right';
  mainEl.before(layout);
  layout.append(left, mainEl, right);
  mountAdSlot(left, 'guideLeft');
  mountAdSlot(right, 'guideRight');
}

async function boot(): Promise<void> {
  await initTheme();
  const page = document.getElementById('app')?.dataset['page'] ?? '';
  const headerEl = document.getElementById('app-header');
  if (headerEl && isSitePageId(page)) mountHeader(headerEl, { page });
  const article = document.getElementById('guide');
  if (article) {
    addTableFilters(article);
    mountGuideAds(article);
  }
}

void boot();

export {};
