/**
 * The guide pages: guides.html, the list, and one page per guide (`GUIDE_IDS`), all written at
 * build time from `src/ui/i18n/en-guides.ts` and the tables of `guide-tables.ts`. The article is
 * static HTML that every visitor sees, with or without JavaScript; nothing on these pages is
 * hidden from people and shown to crawlers. The same text, tables included, goes into
 * llms-full.txt as Markdown.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import tfcVeinsJson from '../../data/tfc-1.20/veins.json';
import { en } from '../../ui/i18n/en';
import { enGuides } from '../../ui/i18n/en-guides';
import type { GuideBlock, GuideCopy, GuideSection } from '../../ui/i18n/en-guides';
import type { Block } from '../../ui/i18n/en-site';
import { formatOreName } from '../../ui/i18n/ore-names';
import { siteFacts } from './facts';
import {
  WORK_BAR,
  guideVeins,
  materialIndex,
  rockLayerTree,
  rockOnlyVeins,
  tfgChangedRuleCount,
  workedExample,
} from './guide-data';
import type { VeinSetId } from './guide-data';
import { guideTable } from './guide-tables';
import type { CellPart, SiteTable, SiteTableCell } from './guide-tables';
import {
  blocksHtml,
  blocksMarkdown,
  escapeAttr,
  escapeMarkdown,
  escapeText,
  fillPlaceholders,
  formatList,
  paragraphText,
} from './markup';
import type { RenderContext } from './markup';
import { GUIDE_IDS } from './site';
import type { GuideId } from './site';
import type { ForgeRule } from '../../forge/model/types';

// --- Placeholders -------------------------------------------------------------------------------

/** "Punch last", "bend not last": a rule as the text names it, the way the FAQ writes them. */
const POSITION_SHORT: Readonly<Record<ForgeRule['position'], string>> = {
  LAST: 'last',
  SECOND_LAST: 'second last',
  THIRD_LAST: 'third last',
  ANY: 'any',
  NOT_LAST: 'not last',
};

function ruleShort(rule: ForgeRule): string {
  const action = rule.type === 'HIT' ? en.forge.actionNames.HIT : en.forge.actionNames[rule.type];
  return `“${action.toLowerCase()} ${POSITION_SHORT[rule.position]}”`;
}

const names = (set: VeinSetId, keep: (vein: ReturnType<typeof guideVeins>[number]) => boolean): string =>
  formatList(guideVeins(set).filter(keep).map((vein) => vein.name));

let cachedPlaceholders: Readonly<Record<string, string>> | null = null;

/**
 * What the guides' `{placeholders}` stand for, read from the data. Kept apart from `facts.ts`'s,
 * which the About page uses; `renderContext` merges the two and fails on a name used twice.
 */
export function guidePlaceholders(): Readonly<Record<string, string>> {
  if (cachedPlaceholders) return cachedPlaceholders;
  const count = (n: number): string => n.toLocaleString('en-US');
  const kaolin = (guideVeins('tfc').find((vein) => vein.key === 'kaolin_disc') ?? null);
  if (kaolin === null || kaolin.size === null || kaolin.height === null || kaolin.indicator === null) {
    throw new Error('guides: TerraFirmaCraft has no kaolin disc to describe');
  }
  const rawKaolin = siteFacts().kaolin;
  const example = workedExample();
  const tail = example.steps.slice(-3).map((step) => step.label.toLowerCase());
  cachedPlaceholders = {
    tfgVeinCount: count(guideVeins('tfg').length),
    tfgMaterialCount: count(materialIndex('tfg').length),
    tfgProjectedCount: count(guideVeins('tfg').filter((vein) => vein.projected).length),
    tfgRockOnlyVeins: formatList(rockOnlyVeins('tfg').map(formatOreName)),
    tfgLavaVeins: names('tfg', (vein) => vein.nearLava),
    tfcVeinCount: count(guideVeins('tfc').length),
    tfcProjectedVeins: names('tfc', (vein) => vein.projected),
    tfcDepositVeins: names('tfc', (vein) => vein.yields.some((y) => y.deposit)),
    tfcRockOnlyVeins: formatList(rockOnlyVeins('tfc').map(formatOreName)),
    tfcLavaVeins: names('tfc', (vein) => vein.nearLava),
    tfcRiverVeins: names('tfc', (vein) => vein.biomeTag === '#tfc:is_river'),
    beneathVeinCount: count(guideVeins('beneath').length),
    moonVeinCount: count(guideVeins('moon').length),
    marsVeinCount: count(guideVeins('mars').length),
    venusVeinCount: count(guideVeins('venus').length),
    // `discVeinBand`'s inputs, for the paragraph that explains it: the disc's own min_y and max_y,
    // its size and height, and the centre the band is built around (band bottom + height).
    kaolinConfigMinY: String(tfcVeinsJson.veins.kaolin_disc.min_y),
    kaolinConfigMaxY: String(tfcVeinsJson.veins.kaolin_disc.max_y),
    kaolinSize: String(kaolin.size),
    kaolinHeight: String(kaolin.height),
    kaolinCentre: String(kaolin.minY + kaolin.height),
    kaolinIndicatorDepth: String(kaolin.indicator.depth),
    tfgKaolinBiomeCount: count(rawKaolin.tfgBiomes.length),
    bottomRocks: formatList(rockLayerTree().bottom.map((id) => (en.rockNames as Readonly<Record<string, string>>)[id] ?? id)),
    workStart: String(WORK_BAR.start),
    workMin: String(WORK_BAR.min),
    workMaxDestroy: String(WORK_BAR.limit),
    targetMin: String(WORK_BAR.targetMin),
    targetMax: String(WORK_BAR.targetMax),
    exampleTarget: String(example.target),
    exampleRules: formatList(example.rules.map(ruleShort)),
    exampleTail: formatList(tail),
    tfgChangedRules: count(tfgChangedRuleCount()),
  };
  return cachedPlaceholders;
}

// --- Rendering ----------------------------------------------------------------------------------

function partHtml(part: CellPart, ctx: RenderContext): string {
  if (typeof part === 'string') return escapeText(part);
  if ('anchor' in part) return `<a href="#${escapeAttr(part.anchor)}">${escapeText(part.text)}</a>`;
  const target = ctx.resolve(part.link);
  const href = part.hash === undefined ? target.href : `${target.href}#${part.hash}`;
  return `<a href="${escapeAttr(href)}">${escapeText(part.text)}</a>`;
}

function cellHtml(cell: SiteTableCell, ctx: RenderContext, header: boolean): string {
  const tag = header ? 'th' : 'td';
  const scope = header ? ' scope="row"' : '';
  const note =
    cell.note === undefined || cell.note.length === 0
      ? ''
      : `<span class="guide-table__note">${cell.note.map((part) => partHtml(part, ctx)).join('')}</span>`;
  return `<${tag}${scope}>${cell.parts.map((part) => partHtml(part, ctx)).join('')}${note}</${tag}>`;
}

export function tableHtml(table: SiteTable, ctx: RenderContext): string {
  const captionId = `table-${table.id}-caption`;
  const filterable = table.filterable ? ' data-filterable="true"' : '';
  return [
    // A region with a name and focus, so a wide table scrolls with the keyboard too.
    `<div class="guide-table" id="table-${escapeAttr(table.id)}" role="region" aria-labelledby="${captionId}" tabindex="0"${filterable}>`,
    `<table>`,
    `<caption id="${captionId}">${escapeText(fillPlaceholders(table.caption, ctx.values))}</caption>`,
    `<thead><tr>${table.columns.map((column) => `<th scope="col">${escapeText(column)}</th>`).join('')}</tr></thead>`,
    `<tbody>`,
    ...table.rows.map((row) => {
      const id = row.id === undefined ? '' : ` id="${escapeAttr(row.id)}"`;
      return `<tr${id}>${row.cells.map((cell, index) => cellHtml(cell, ctx, index === 0)).join('')}</tr>`;
    }),
    `</tbody>`,
    `</table>`,
    `</div>`,
  ].join('\n');
}

function partMarkdown(part: CellPart, ctx: RenderContext): string {
  if (typeof part === 'string') return escapeMarkdown(part);
  // A row of this page has no address in one combined file: keep the words.
  if ('anchor' in part) return escapeMarkdown(part.text);
  const target = ctx.resolve(part.link);
  return `[${escapeMarkdown(part.text)}](${part.hash === undefined ? target.href : `${target.href}#${part.hash}`})`;
}

const pipeSafe = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function tableMarkdown(table: SiteTable, ctx: RenderContext): string {
  const cell = (c: SiteTableCell): string => {
    const main = c.parts.map((part) => partMarkdown(part, ctx)).join('');
    const note = c.note === undefined || c.note.length === 0 ? '' : ` (${c.note.map((part) => partMarkdown(part, ctx)).join('')})`;
    return pipeSafe(`${main}${note}`);
  };
  return [
    `**${escapeMarkdown(fillPlaceholders(table.caption, ctx.values))}**`,
    '',
    `| ${table.columns.map((column) => pipeSafe(escapeMarkdown(column))).join(' | ')} |`,
    `| ${table.columns.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.cells.map(cell).join(' | ')} |`),
  ].join('\n');
}

const isTable = (block: GuideBlock): block is { readonly table: SiteTable['id'] } => 'table' in block;

function guideBlocksHtml(blocks: readonly GuideBlock[], ctx: RenderContext): string {
  const out: string[] = [];
  let run: Block[] = [];
  const flush = (): void => {
    if (run.length > 0) out.push(blocksHtml(run, ctx));
    run = [];
  };
  for (const block of blocks) {
    if (isTable(block)) {
      flush();
      out.push(tableHtml(guideTable(block.table), ctx));
    } else {
      run.push(block);
    }
  }
  flush();
  return out.join('\n');
}

function guideBlocksMarkdown(blocks: readonly GuideBlock[], ctx: RenderContext): string {
  return blocks
    .map((block) => (isTable(block) ? tableMarkdown(guideTable(block.table), ctx) : blocksMarkdown([block], ctx)))
    .filter((text) => text !== '')
    .join('\n\n');
}

export const guideCopy = (id: GuideId): GuideCopy => enGuides.pages[id];

/** The guide's heading, for the page and its card. */
export const guideTitle = (id: GuideId, ctx: RenderContext): string => fillPlaceholders(guideCopy(id).title, ctx.values);

export function guideDescription(id: GuideId | 'guides', ctx: RenderContext): string {
  return fillPlaceholders(id === 'guides' ? enGuides.index.description : guideCopy(id).description, ctx.values);
}

function sectionHtml(section: GuideSection, ctx: RenderContext): string {
  return [
    `<section id="${escapeAttr(section.id)}">`,
    `<h2>${escapeText(fillPlaceholders(section.heading, ctx.values))}</h2>`,
    guideBlocksHtml(section.blocks, ctx),
    `</section>`,
  ].join('\n');
}

function contentsHtml(sections: readonly GuideSection[], ctx: RenderContext): string {
  const items = sections.map(
    (section) =>
      `<li><a href="#${escapeAttr(section.id)}">${escapeText(fillPlaceholders(section.heading, ctx.values))}</a></li>`,
  );
  return [
    `<nav class="guide__contents" aria-label="${escapeAttr(enGuides.common.contentsLabel)}">`,
    `<ul>${items.join('')}</ul>`,
    `</nav>`,
  ].join('\n');
}

function relatedHtml(id: GuideId, ctx: RenderContext): string {
  const items = guideCopy(id).related.map((other) => {
    const target = ctx.resolve(other);
    return `<li><a href="${escapeAttr(target.href)}">${escapeText(guideCopy(other).short)}</a>: ${escapeText(fillPlaceholders(guideCopy(other).summary, ctx.values))}</li>`;
  });
  return [
    `<aside class="guide__related" aria-labelledby="related-heading">`,
    `<h2 id="related-heading">${escapeText(enGuides.common.relatedHeading)}</h2>`,
    `<ul>${items.join('')}</ul>`,
    `</aside>`,
  ].join('\n');
}

function sourceNoteHtml(ctx: RenderContext): string {
  const issues = ctx.resolve('issues');
  return `<p class="guide__source">${escapeText(enGuides.common.sourceNote)}<a href="${escapeAttr(issues.href)}" target="_blank" rel="noopener noreferrer">${escapeText(enGuides.common.sourceLink)}</a>.</p>`;
}

/** One guide's article: everything on the page, as static HTML. */
export function guideArticleHtml(id: GuideId, ctx: RenderContext): string {
  const copy = guideCopy(id);
  const index = ctx.resolve('guides');
  return [
    `<nav class="guide__crumbs" aria-label="${escapeAttr(enGuides.common.breadcrumbLabel)}">`,
    `<a href="${escapeAttr(index.href)}">${escapeText(en.nav.guides)}</a> <span aria-hidden="true">›</span> <span aria-current="page">${escapeText(copy.short)}</span>`,
    `</nav>`,
    `<h1>${escapeText(guideTitle(id, ctx))}</h1>`,
    `<div class="guide__lead">`,
    blocksHtml(copy.lead, ctx),
    `</div>`,
    contentsHtml(copy.sections, ctx),
    ...copy.sections.map((section) => sectionHtml(section, ctx)),
    relatedHtml(id, ctx),
    sourceNoteHtml(ctx),
    `<p class="site-disclaimer">${escapeText(en.disclaimer)}</p>`,
  ].join('\n');
}

/** guides.html's article: what the guides are, a card for each, and how they are made. */
export function guidesIndexHtml(ctx: RenderContext): string {
  const copy = enGuides.index;
  const cards = GUIDE_IDS.map((id) => {
    const target = ctx.resolve(id);
    return [
      `<li class="guide-card">`,
      `<h3><a href="${escapeAttr(target.href)}">${escapeText(guideTitle(id, ctx))}</a></h3>`,
      `<p>${escapeText(fillPlaceholders(guideCopy(id).summary, ctx.values))}</p>`,
      `</li>`,
    ].join('');
  });
  return [
    `<h1>${escapeText(copy.title)}</h1>`,
    `<div class="guide__lead">`,
    blocksHtml(copy.lead, ctx),
    `</div>`,
    `<section id="list">`,
    `<h2>${escapeText(copy.listHeading)}</h2>`,
    `<ul class="guide-list">${cards.join('\n')}</ul>`,
    `</section>`,
    `<section id="how">`,
    `<h2>${escapeText(copy.aboutHeading)}</h2>`,
    blocksHtml(copy.about, ctx),
    `</section>`,
    sourceNoteHtml(ctx),
    `<p class="site-disclaimer">${escapeText(en.disclaimer)}</p>`,
  ].join('\n');
}

/** The forge page's own "how the anvil works", visible under the calculator. */
export function forgeGuideHtml(ctx: RenderContext): string {
  const copy = enGuides.forgeSection;
  return [`<h2 id="forge-guide-title">${escapeText(copy.heading)}</h2>`, blocksHtml(copy.blocks, ctx)].join('\n');
}

/** One guide as Markdown, for llms-full.txt: the same text and tables as the page. */
export function guideMarkdown(id: GuideId, ctx: RenderContext): string {
  const copy = guideCopy(id);
  const url = ctx.resolve(id).href;
  return [
    `# ${escapeMarkdown(guideTitle(id, ctx))}`,
    `Source: ${url}`,
    blocksMarkdown(copy.lead, ctx),
    ...copy.sections.map(
      (section) =>
        `## ${escapeMarkdown(fillPlaceholders(section.heading, ctx.values))}\n\n${guideBlocksMarkdown(section.blocks, ctx)}`,
    ),
  ].join('\n\n');
}

/** A guide's one-line summary, as plain text. */
export const guideSummary = (id: GuideId, ctx: RenderContext): string =>
  paragraphText([guideCopy(id).summary], ctx);
