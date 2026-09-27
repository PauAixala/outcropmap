import tfcData from '@data/tfc-1.20/anvil-recipes.json';
import tfgData from '@data/tfg/anvil-recipes.json';
import { anvilTargetWork, parseRule } from '@forge/index';
import type { ForgeRule } from '@forge/index';
import type { ProfileId } from '@worldgen/api/types';
import { GLYPH_GRID, PANEL_GLYPHS, createGlyphSvg, glyphToPathData } from '@ui/icons/glyphs';
import { ITEM_GLYPHS, itemGlyphFor } from '@ui/icons/item-glyphs';
import { metalColour } from '@ui/icons/metal-colours';
import { en } from '@ui/i18n/en';
import { mountSolvePanel } from './forge-solve';
import type { SolvePanel } from './forge-solve';

export interface CatalogRecipe {
  readonly id: string;
  /** Full resource id (`tfc:anvil/steel_mining_hammer_head`), which the target hash is taken of. */
  readonly recipeId?: string;
  readonly input: { readonly item?: string; readonly tag?: string };
  readonly result: { readonly count?: number; readonly item: string };
  readonly rules: readonly string[];
  readonly tier: number;
}

interface Catalog {
  readonly id: ProfileId;
  readonly label: string;
  readonly recipes: readonly CatalogRecipe[];
}

const catalogs: readonly Catalog[] = [
  { id: 'tfc-1.20', label: en.profileNames['tfc-1.20'], recipes: Object.values(tfcData.recipes) },
  { id: 'tfg', label: en.profileNames.tfg, recipes: Object.values(tfgData.recipes) },
];

function readableId(value: string): string {
  const path = value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
  return path
    .split('/')
    .at(-1)!
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Human-readable item name from a resource id — the UI never shows `tfc:metal/ingot/wrought_iron`
 * (docs/PLAN.md 10c P2).
 *
 * TFC's ids are structured enough to read directly: `metal/<part>/<material>` names the material
 * first ("Wrought Iron Ingot"), and an item tag is `<plural>/<material>` ("forge:ingots/steel" ->
 * "Steel Ingot"). Anything that matches neither shape falls back to its last path segment, which is
 * still a name rather than an id. This is presentation only: no display string is ever used to
 * identify a recipe.
 */
function itemDisplayName(value: { readonly item?: string; readonly tag?: string }): string {
  const raw = value.item ?? value.tag;
  if (raw === undefined) return '—';
  const path = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
  const parts = path.split('/');
  const words = (segment: string): string =>
    segment
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  if (parts.length >= 3 && parts[0] === 'metal') {
    const part = parts[1] ?? '';
    const material = parts.slice(2).join(' ');
    return `${words(material)} ${words(part)}`;
  }
  if (parts.length === 2) {
    const [group = '', material = ''] = parts;
    // Tag groups are plural ("ingots", "double_sheets"); the item is one of them.
    const singular = group.endsWith('s') ? group.slice(0, -1) : group;
    return `${words(material)} ${words(singular)}`;
  }
  return words(parts.at(-1) ?? path);
}

/** The raw id, kept for search only — never shown. */
function itemReference(value: { readonly item?: string; readonly tag?: string }): string {
  return value.item ?? value.tag ?? '—';
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The category glyph for a recipe's result, drawn from our own geometry (docs/PLAN.md 10c P3). */
function resultGlyph(recipe: CatalogRecipe): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${GLYPH_GRID} ${GLYPH_GRID}`);
  svg.setAttribute('aria-hidden', 'true');
  const data = glyphToPathData(ITEM_GLYPHS[itemGlyphFor(recipe.result.item)]);

  // Drawn twice: a dark outline behind, the metal face in front. A flat one-colour silhouette reads
  // as a stencil; the outline is what makes it read as a forged object, and it is the same
  // vocabulary as the hero mark and the favicon. Two paths rather than a stroke on one, so
  // the outline sits *outside* the shape instead of eating a unit off every edge.
  const outline = document.createElementNS(SVG_NS, 'path');
  outline.setAttribute('d', data);
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', 'var(--forge-line)');
  outline.setAttribute('stroke-width', '2.5');
  outline.setAttribute('stroke-linejoin', 'round');

  const face = document.createElementNS(SVG_NS, 'path');
  face.setAttribute('d', data);
  face.setAttribute('fill', 'currentColor');
  face.setAttribute('fill-rule', 'evenodd');

  svg.append(outline, face);
  return svg;
}

/**
 * A sunken socket holding one glyph -- an inventory slot, in the Anvil grammar.
 *
 * The glyph's face fills with `currentColor`, so colouring the whole marker by the metal the recipe
 * works is one `color` on the socket. 565 recipes drawn in one colour is a list you can only read
 * line by line; the metal is what a player narrows by first.
 */
function glyphSocket(recipe: CatalogRecipe, className: string): HTMLSpanElement {
  const socket = document.createElement('span');
  socket.className = className;
  socket.style.color = metalColour(recipe.input.item ?? recipe.input.tag ?? recipe.result.item);
  socket.append(resultGlyph(recipe));
  return socket;
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Everything after the `mod:` prefix — searching "min" must not match every `minecraft:` item. */
function withoutNamespace(value: string): string {
  return value.includes(':') ? value.slice(value.indexOf(':') + 1) : value;
}

/**
 * Every word of the query has to appear somewhere, in any order: "black sp" finds
 * "black_steel_spade_head", which a single substring test cannot, because the words are not
 * adjacent. Exported for its test.
 */
export function matchesSearch(recipe: CatalogRecipe, query: string): boolean {
  const haystack = normalizeSearch(
    [recipe.id, itemReference(recipe.input), recipe.result.item].map(withoutNamespace).join(' '),
  );
  return normalizeSearch(query)
    .split(' ')
    .filter((word) => word !== '')
    .every((word) => haystack.includes(word));
}

export interface ForgePicker {
  profile(): ProfileId;
}

export function mountForgePicker(
  container: HTMLElement,
  options: {
    readonly initialProfile: ProfileId;
    readonly onProfileChange: (profile: ProfileId) => void;
    /** The world seed, shared with the map page, used to derive each recipe's target work. */
    readonly initialSeed?: bigint | undefined;
    readonly onSeedChange?: (seed: bigint | null) => void;
  },
): ForgePicker {
  let activeCatalog =
    catalogs.find((catalog) => catalog.id === options.initialProfile) ?? catalogs[0]!;
  let selected: CatalogRecipe | null = null;

  const heading = document.createElement('h3');
  heading.append(
    createGlyphSvg(PANEL_GLYPHS.recipes, 'forge-heading__icon'),
    document.createTextNode(en.forge.catalogHeading),
  );

  const profile = document.createElement('select');
  for (const catalog of catalogs) {
    const option = document.createElement('option');
    option.value = catalog.id;
    option.textContent = catalog.label;
    profile.append(option);
  }
  profile.value = activeCatalog.id;
  const profileLabel = document.createElement('label');
  profileLabel.className = 'field-label';
  profileLabel.append(document.createTextNode(en.forge.catalogProfileLabel), profile);

  let seed: bigint | null = options.initialSeed ?? null;
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.inputMode = 'numeric';
  seedInput.placeholder = en.seed.placeholder;
  seedInput.className = 'forge-catalog__seed';
  if (seed !== null) seedInput.value = seed.toString();
  const seedLabel = document.createElement('label');
  seedLabel.className = 'field-label';
  seedLabel.append(document.createTextNode(en.seed.label), seedInput);

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = en.forge.catalogSearchPlaceholder;
  const searchLabel = document.createElement('label');
  searchLabel.className = 'field-label';
  searchLabel.append(document.createTextNode(en.forge.catalogSearchLabel), search);

  const controls = document.createElement('div');
  controls.className = 'forge-catalog__controls';
  controls.append(profileLabel, seedLabel, searchLabel);

  const count = document.createElement('p');
  count.className = 'forge-catalog__count';
  const list = document.createElement('div');
  list.className = 'forge-catalog__list';
  const detail = document.createElement('article');
  detail.className = 'forge-catalog__detail';
  let solvePanel: SolvePanel | null = null;

  function renderDetail(recipe: CatalogRecipe): void {
    const title = document.createElement('h4');
    title.className = 'forge-catalog__title';
    title.append(
      glyphSocket(recipe, 'forge-catalog__glyph forge-catalog__glyph--large'),
      document.createTextNode(readableId(recipe.id)),
    );
    const tier = document.createElement('span');
    tier.className = 'forge-catalog__tier';
    // The catalogue keeps the game's own tier, and a recipe that names none is TFC's -1: any anvil.
    // "Anvil tier -1" is what that read as once the dump reached `tfg:anvil/soaked_unrefined_paper`.
    tier.textContent = recipe.tier < 0 ? en.forge.catalogAnyTier : `${en.forge.catalogTier} ${recipe.tier}`;

    const fields = document.createElement('dl');
    fields.className = 'forge-catalog__fields';
    for (const [label, value] of [
      [en.forge.catalogInput, itemDisplayName(recipe.input)],
      [
        en.forge.catalogOutput,
        `${recipe.result.count === undefined ? '' : `${recipe.result.count} × `}${itemDisplayName(recipe.result)}`,
      ],
    ] as const) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      fields.append(term, description);
    }

    // The finishing rules are not listed: the solution below states the exact steps in order, which
    // is the same information without a second list to read against it.
    detail.replaceChildren(title, tier, fields);

    // The solution belongs in the box of the recipe it solves, directly under the rules that
    // constrain it (docs/PLAN.md 10c P2).
    solvePanel = mountSolvePanel(detail, {
      profile: () => activeCatalog.id,
      ownTargetField: true,
      read: () => {
        const parsed: ForgeRule[] = [];
        for (const rule of recipe.rules) {
          try {
            parsed.push(parseRule(rule));
          } catch {
            return { ok: false, error: `${en.forge.catalogRuleUnreadable}: ${rule}` };
          }
        }
        return { ok: true, rules: parsed };
      },
    });
    applyTarget();
  }

  /**
   * The anvil's number is `40 + hash(seed, recipe id) % 74` (`AnvilRecipe.computeTarget`), so with a
   * seed the field answers itself. Without one — or for a recipe whose full id we do not carry — it
   * is left empty for the player to read off the anvil.
   */
  function applyTarget(): void {
    if (!solvePanel) return;
    const recipeId = selected?.recipeId;
    solvePanel.setTarget(seed !== null && recipeId ? anvilTargetWork(seed, recipeId) : null);
  }

  function renderList(): void {
    const visible = activeCatalog.recipes.filter((recipe) => matchesSearch(recipe, search.value));
    count.textContent = `${visible.length} ${en.forge.catalogCount}`;
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'forge-catalog__empty';
      empty.textContent = en.forge.catalogNoResults;
      list.append(empty);
      detail.replaceChildren();
      selected = null;
      return;
    }
    if (selected === null || !visible.includes(selected)) selected = visible[0] ?? null;
    for (const recipe of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'forge-catalog__recipe';
      button.classList.toggle('forge-catalog__recipe--selected', recipe === selected);
      const name = document.createElement('span');
      name.className = 'forge-catalog__recipe-name';
      name.textContent = readableId(recipe.id);
      button.replaceChildren(glyphSocket(recipe, 'forge-catalog__glyph'), name);
      button.addEventListener('click', () => {
        selected = recipe;
        solvePanel?.clear();
        renderList();
        renderDetail(recipe);
      });
      list.append(button);
    }
    if (selected) renderDetail(selected);
  }

  profile.addEventListener('change', () => {
    activeCatalog = catalogs.find((catalog) => catalog.id === profile.value) ?? catalogs[0]!;
    selected = null;
    options.onProfileChange(activeCatalog.id);
    renderList();
  });
  search.addEventListener('input', renderList);
  seedInput.addEventListener('input', () => {
    const raw = seedInput.value.trim();
    seed = /^-?\d+$/.test(raw) ? BigInt(raw) : null;
    options.onSeedChange?.(seed);
    applyTarget();
  });

  const browser = document.createElement('div');
  browser.className = 'forge-catalog__browser';
  browser.append(list, detail);
  container.classList.add('forge-catalog');
  container.replaceChildren(heading, controls, count, browser);
  renderList();
  return { profile: () => activeCatalog.id };
}
