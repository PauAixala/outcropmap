/**
 * Turns the site text (`src/ui/i18n/en-site.ts`: paragraphs, lists and links) into HTML for the
 * pages, Markdown for llms-full.txt, and plain text for structured data — one text, three
 * renderings, so they never disagree. Pure string work, no DOM: it runs inside vite.config.ts at
 * build time and in Node tests.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import type { Block, Inline, Paragraph, SiteLink } from '../../ui/i18n/en-site';

/** Where a link goes; `external` links open in a new tab and send no referrer. */
export interface LinkTarget {
  readonly href: string;
  readonly external: boolean;
}

export interface RenderContext {
  /** What each `{placeholder}` stands for (`factPlaceholders`). An unknown one is a build error. */
  readonly values: Readonly<Record<string, string>>;
  /** Whether this build shows ads, for blocks marked `when`. */
  readonly ads: boolean;
  readonly resolve: (link: SiteLink) => LinkTarget;
}

/** Text content: `&`, `<` and `>` escaped. */
export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A double-quoted attribute value. */
export function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** "A", "A and B", "A, B and C" — the house style has no serial comma. */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/** Replaces each `{name}` with its value; a name with no value throws, so a typo fails the build. */
export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`site text: no value for {${name}} in "${text}"`);
    return value;
  });
}

function shown(block: Block, ctx: RenderContext): boolean {
  if (!('p' in block) || block.when === undefined) return true;
  return block.when === 'ads' ? ctx.ads : !ctx.ads;
}

/** The blocks this build shows. */
export function visibleBlocks(blocks: readonly Block[], ctx: RenderContext): Block[] {
  return blocks.filter((block) => shown(block, ctx));
}

function inlineText(part: Inline, ctx: RenderContext): string {
  return fillPlaceholders(typeof part === 'string' ? part : part.text, ctx.values);
}

// --- HTML ---

function inlineHtml(part: Inline, ctx: RenderContext): string {
  const text = escapeText(inlineText(part, ctx));
  if (typeof part === 'string') return text;
  const target = ctx.resolve(part.link);
  const external = target.external ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${escapeAttr(target.href)}"${external}>${text}</a>`;
}

export function paragraphHtml(paragraph: Paragraph, ctx: RenderContext): string {
  return paragraph.map((part) => inlineHtml(part, ctx)).join('');
}

export function blocksHtml(blocks: readonly Block[], ctx: RenderContext): string {
  return visibleBlocks(blocks, ctx)
    .map((block) => {
      if ('p' in block) return `<p>${paragraphHtml(block.p, ctx)}</p>`;
      const items = 'list' in block ? block.list : block.steps;
      const tag = 'list' in block ? 'ul' : 'ol';
      return `<${tag}>${items.map((item) => `<li>${paragraphHtml(item, ctx)}</li>`).join('')}</${tag}>`;
    })
    .join('\n');
}

// --- Markdown ---

/** Escapes the few characters Markdown would read as markup inside running text. */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function inlineMarkdown(part: Inline, ctx: RenderContext): string {
  const text = escapeMarkdown(inlineText(part, ctx));
  if (typeof part === 'string') return text;
  return `[${text}](${ctx.resolve(part.link).href})`;
}

export function paragraphMarkdown(paragraph: Paragraph, ctx: RenderContext): string {
  return paragraph.map((part) => inlineMarkdown(part, ctx)).join('');
}

export function blocksMarkdown(blocks: readonly Block[], ctx: RenderContext): string {
  return visibleBlocks(blocks, ctx)
    .map((block) => {
      if ('p' in block) return paragraphMarkdown(block.p, ctx);
      if ('list' in block)
        return block.list.map((item) => `- ${paragraphMarkdown(item, ctx)}`).join('\n');
      return block.steps.map((item, i) => `${i + 1}. ${paragraphMarkdown(item, ctx)}`).join('\n');
    })
    .join('\n\n');
}

// --- Plain text ---

export function paragraphText(paragraph: Paragraph, ctx: RenderContext): string {
  return paragraph.map((part) => inlineText(part, ctx)).join('');
}

/** Plain text, for structured data: paragraphs and list items joined by spaces. */
export function blocksText(blocks: readonly Block[], ctx: RenderContext): string {
  return visibleBlocks(blocks, ctx)
    .flatMap((block) => {
      if ('p' in block) return [paragraphText(block.p, ctx)];
      return ('list' in block ? block.list : block.steps).map((item) => paragraphText(item, ctx));
    })
    .join(' ');
}
