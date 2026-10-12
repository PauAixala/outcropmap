/**
 * The guides' tables, built from game data (`guide-data.ts`) with the captions, headings and cell
 * wording of `src/ui/i18n/en-guides.ts`. A table is plain data here; `guides.ts` renders it as
 * HTML for the page and as Markdown for llms-full.txt, so the two always show the same rows.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import { en } from '../../ui/i18n/en';
import type { SiteLink } from '../../ui/i18n/en-site';
import { enGuides } from '../../ui/i18n/en-guides';
import type { GuideTableId } from '../../ui/i18n/en-guides';
import { formatDelta } from './facts';
import { formatList } from './markup';
import {
  FOREST_ORDER,
  anvilActions,
  guideDimensions,
  guideRocks,
  guideStructures,
  guideVeins,
  materialIndex,
  recipesPerTier,
  ruleLabel,
  rockLayerTree,
  tfcRecipeGroups,
  veinBiomeGroups,
  veinsByHostRock,
  workedExample,
} from './guide-data';
import type { GuideStructure, GuideVein, VeinSetId } from './guide-data';

/** Text, a link to a row or section of the same page, or a link to another page of the site. */
export type CellPart =
  | string
  | { readonly text: string; readonly anchor: string }
  | { readonly text: string; readonly link: SiteLink; readonly hash?: string };

export interface SiteTableCell {
  readonly parts: readonly CellPart[];
  /** A second, smaller line under the cell's text. */
  readonly note?: readonly CellPart[];
}

export interface SiteTableRow {
  /** The row's fragment id, so other cells and pages can link to it. */
  readonly id?: string;
  readonly cells: readonly SiteTableCell[];
}

export interface SiteTable {
  readonly id: GuideTableId;
  /** May hold `{placeholders}`, filled by the page like its text. */
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly SiteTableRow[];
  /** Long tables get a filter box on the page (src/pages/guide/main.ts). */
  readonly filterable: boolean;
}

const F = enGuides.formats;

/** Fills a cell template; a missing value is a bug in this file, so it throws. */
export function format(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`guide table: no value for {${key}} in "${template}"`);
    return String(value);
  });
}

/** A signed number with a real minus sign: `−64`. */
export const signed = (n: number): string => (n < 0 ? `\u2212${-n}` : String(n));

/** A share as a whole percentage; anything that rounds to nothing still shows. */
export function percent(share: number): string {
  const value = share * 100;
  return value > 0 && value < 0.5 ? '<1%' : `${Math.round(value)}%`;
}

const count = (n: number): string => n.toLocaleString('en-US');
const text = (value: string, note?: readonly CellPart[]): SiteTableCell =>
  note === undefined || note.length === 0 ? { parts: [value] } : { parts: [value], note };

/** Parts joined with a separator, for cells that list several links. */
function joined(parts: readonly CellPart[], separator = ', '): CellPart[] {
  return parts.flatMap((part, index) => (index === 0 ? [part] : [separator, part]));
}

export const veinAnchor = (vein: GuideVein): string => `vein-${vein.key}`;

// --- Veins --------------------------------------------------------------------------------------

export function yieldsText(vein: GuideVein): string {
  return vein.yields
    .map((y) => {
      const name = y.deposit ? format(F.deposit, { name: y.name }) : y.name;
      const grades = y.grades
        ? ` (${format(F.grades, { poor: percent(y.grades.poor), normal: percent(y.grades.normal), rich: percent(y.grades.rich) })})`
        : '';
      return `${name} ${percent(y.share)}${grades}`;
    })
    .join(', ');
}

export function yRangeText(vein: Pick<GuideVein, 'minY' | 'maxY' | 'projected'>): string {
  if (!vein.projected) return format(F.yAbsolute, { min: signed(vein.minY), max: signed(vein.maxY) });
  if (vein.maxY >= 0) return format(F.yFromSurface, { bottom: -vein.minY });
  return format(F.yBelowSurface, { top: -vein.maxY, bottom: -vein.minY });
}

function shapeText(vein: GuideVein): string {
  if (vein.shape === 'disc' && vein.size !== null && vein.height !== null) {
    return format(F.disc, { across: 2 * vein.size + 1, thick: 2 * vein.height + 1 });
  }
  if (vein.shape === 'pipe' && vein.radius !== null) return format(F.pipe, { radius: vein.radius });
  if (vein.shape === 'cluster' && vein.size !== null) return format(F.cluster, { size: vein.size });
  return vein.shape;
}

function indicatorText(vein: GuideVein): string {
  if (vein.indicator === null) return F.indicatorNone;
  return vein.indicator.blocks.length > 0
    ? format(F.indicatorNamed, { names: formatList(vein.indicator.blocks), depth: vein.indicator.depth })
    : format(F.indicatorDepth, { depth: vein.indicator.depth });
}

function measuredText(vein: GuideVein): string {
  if (vein.measured === null) return F.measuredNone;
  const value = percent(vein.measured.precision);
  return format(vein.measured.hidden ? F.measuredHidden : F.measured, { percent: value });
}

const isKaolin = (vein: GuideVein): boolean => vein.yields.some((y) => y.material === 'kaolin');

/** The small line under a vein's name: where it is limited to, and why the map may not show it. */
function veinNote(vein: GuideVein, set: VeinSetId): CellPart[] {
  const notes: CellPart[][] = [];
  if (isKaolin(vein)) {
    notes.push([{ text: F.kaolinNote, link: 'kaolin-clay' }]);
  } else if (vein.biomes.length > 0 && set !== 'beneath') {
    notes.push(
      vein.biomes.length <= 3
        ? [format(F.onlyIn, { biomes: formatList(vein.biomes) })]
        : [{ text: format(F.onlyInMany, { count: vein.biomes.length }), anchor: 'biomes' }],
    );
  }
  if (vein.nearLava) notes.push([F.nearLava]);
  return notes.flatMap((note, index) => (index === 0 ? note : ['; ', ...note]));
}

type VeinTableId = 'tfgVeins' | 'tfcVeins' | 'beneathVeins' | 'moonVeins' | 'marsVeins' | 'venusVeins';

const VEIN_TABLE_SETS: Readonly<Record<VeinTableId, VeinSetId>> = {
  tfgVeins: 'tfg',
  tfcVeins: 'tfc',
  beneathVeins: 'beneath',
  moonVeins: 'moon',
  marsVeins: 'mars',
  venusVeins: 'venus',
};

function veinTable(id: GuideTableId, set: VeinSetId): SiteTable {
  const rows = guideVeins(set).map((vein): SiteTableRow => {
    const cells: SiteTableCell[] = [
      text(vein.name, veinNote(vein, set)),
      text(yieldsText(vein)),
      text(yRangeText(vein)),
      text(format(F.rarity, { n: count(vein.rarity) })),
      text(shapeText(vein)),
    ];
    if (set === 'beneath') cells.push(text(formatList(vein.biomes)));
    else cells.push(text(vein.hosts.length > 0 ? vein.hosts.map((host) => host.name).join(', ') : F.noHosts));
    if (set === 'tfg' || set === 'tfc') cells.push(text(indicatorText(vein)));
    if (set !== 'tfc') cells.push(text(measuredText(vein)));
    return { id: veinAnchor(vein), cells };
  });
  return { id, ...enGuides.tables[id], rows, filterable: true };
}

function materialTable(id: GuideTableId, set: VeinSetId): SiteTable {
  const rows = materialIndex(set).map(
    (material): SiteTableRow => ({
      id: `material-${material.material}`,
      cells: [
        text(material.name),
        {
          parts: joined(
            material.sources.map((source) => ({
              text: `${source.deposit ? format(F.deposit, { name: source.vein.name }) : source.vein.name} ${percent(source.share)}`,
              anchor: veinAnchor(source.vein),
            })),
          ),
        },
      ],
    }),
  );
  return { id, ...enGuides.tables[id], rows, filterable: true };
}

/** `#tfg:earth/is_mountain` -> "Mountain"; `#tfc:kaolin_clay_spawns_in` -> "Kaolin clay spawns in". */
export function biomeGroupName(tag: string): string {
  const bare = tag.replace(/^#/, '').replace(/^[^:]+:/, '');
  const words = (bare.slice(bare.lastIndexOf('/') + 1).replace(/^is_/, '') || bare).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function biomeGroupTable(): SiteTable {
  const rows = veinBiomeGroups('tfg').map(
    (group): SiteTableRow => ({
      cells: [
        text(biomeGroupName(group.tag)),
        text(formatList(group.biomes)),
        { parts: joined(group.veins.map((vein) => ({ text: vein.name, anchor: veinAnchor(vein) }))) },
      ],
    }),
  );
  return { id: 'tfgBiomeGroups', ...enGuides.tables.tfgBiomeGroups, rows, filterable: false };
}

// --- Rocks --------------------------------------------------------------------------------------

function rockTable(): SiteTable {
  const tfc = veinsByHostRock('tfc');
  const tfg = veinsByHostRock('tfg');
  const links = (veins: readonly GuideVein[], page: SiteLink): SiteTableCell =>
    veins.length === 0
      ? text(F.none)
      : { parts: joined(veins.map((vein) => ({ text: vein.name, link: page, hash: veinAnchor(vein) }))) };
  const rows = guideRocks()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (rock): SiteTableRow => ({
        id: `rock-${rock.id}`,
        cells: [
          text(rock.name),
          text(rock.category),
          links(tfc.get(rock.id) ?? [], 'tfc-ore-veins'),
          links(tfg.get(rock.id) ?? [], 'tfg-ore-veins'),
        ],
      }),
    );
  return { id: 'rocks', ...enGuides.tables.rocks, rows, filterable: true };
}

const layerName = (id: string): string => enGuides.layerNames[id] ?? id;
const rockName = (id: string): string => (en.rockNames as Readonly<Record<string, string>>)[id] ?? id;

function rockLayerTable(): SiteTable {
  const tree = rockLayerTree();
  const rows: SiteTableRow[] = tree.layers.flatMap((layer) =>
    layer.entries.map(
      (entry): SiteTableRow => ({
        cells: [text(layerName(layer.id)), text(rockName(entry.rock)), text(layerName(entry.below))],
      }),
    ),
  );
  rows.push({
    cells: [text(layerName('bottom')), text(formatList(tree.bottom.map(rockName))), text(F.none)],
  });
  return { id: 'rockLayers', ...enGuides.tables.rockLayers, rows, filterable: false };
}

function rockStartTable(): SiteTable {
  const tree = rockLayerTree();
  const order = ['oceanFloor', 'volcanic', 'uplift', 'land'] as const;
  const rows = order.map(
    (area): SiteTableRow => ({
      cells: [
        text(enGuides.rockStarts[area].name),
        text(enGuides.rockStarts[area].where),
        text(formatList(tree.starts[area].map(layerName))),
      ],
    }),
  );
  return { id: 'rockStarts', ...enGuides.tables.rockStarts, rows, filterable: false };
}

// --- The anvil ----------------------------------------------------------------------------------

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];

export const tierName = (tier: number): string =>
  tier < 0 ? F.anyTier : format(F.tier, { tier: ROMAN[tier] ?? String(tier) });

function anvilActionTable(): SiteTable {
  const rows = anvilActions().map((action): SiteTableRow => ({ cells: [text(action.label), text(formatDelta(action.delta))] }));
  return { id: 'anvilActions', ...enGuides.tables.anvilActions, rows, filterable: false };
}

function anvilExampleTable(): SiteTable {
  const rows = workedExample().steps.map(
    (step, index): SiteTableRow => ({
      cells: [text(String(index + 1)), text(step.label), text(formatDelta(step.delta)), text(format(F.work, { work: step.work }))],
    }),
  );
  return { id: 'anvilExample', ...enGuides.tables.anvilExample, rows, filterable: false };
}

function anvilTierTable(): SiteTable {
  const rows = recipesPerTier().map(
    (tier): SiteTableRow => ({ cells: [text(tierName(tier.tier)), text(count(tier.tfc)), text(count(tier.tfg))] }),
  );
  return { id: 'anvilTiers', ...enGuides.tables.anvilTiers, rows, filterable: false };
}

function anvilRecipeTable(): SiteTable {
  const rows = tfcRecipeGroups().map(
    (group): SiteTableRow => ({
      id: `recipe-${group.kind}`,
      cells: [
        text(group.name),
        text(group.rules.map(ruleLabel).join('; ')),
        text(group.inputs.join(', ')),
        text(group.metals.map((metal) => format(F.metalTier, { metal: metal.name, tier: tierName(metal.tier) })).join(', ')),
      ],
    }),
  );
  return { id: 'anvilRecipes', ...enGuides.tables.anvilRecipes, rows, filterable: true };
}

// --- Structures ---------------------------------------------------------------------------------

export function climateText(structure: GuideStructure): string {
  const c = structure.climate;
  if (c === null) return F.climateAny;
  const parts: string[] = [];
  if (c.min_temperature !== undefined && c.max_temperature !== undefined) {
    parts.push(format(F.climateTemperature, { min: signed(c.min_temperature), max: signed(c.max_temperature) }));
  } else if (c.min_temperature !== undefined) {
    parts.push(format(F.climateTemperatureMin, { min: signed(c.min_temperature) }));
  } else if (c.max_temperature !== undefined) {
    parts.push(format(F.climateTemperatureMax, { max: signed(c.max_temperature) }));
  }
  if (c.min_rainfall !== undefined && c.max_rainfall !== undefined) {
    parts.push(format(F.climateRainfall, { min: c.min_rainfall, max: c.max_rainfall }));
  } else if (c.min_rainfall !== undefined) {
    parts.push(format(F.climateRainfallMin, { min: c.min_rainfall }));
  } else if (c.max_rainfall !== undefined) {
    parts.push(format(F.climateRainfallMax, { max: c.max_rainfall }));
  }
  const forest = (id: string): string => enGuides.forests[id] ?? id;
  if (c.min_forest !== undefined && c.min_forest !== FOREST_ORDER[0]) {
    parts.push(format(F.climateForestMin, { forest: forest(c.min_forest) }));
  }
  if (c.max_forest !== undefined && c.max_forest !== FOREST_ORDER[FOREST_ORDER.length - 1]) {
    parts.push(format(F.climateForestMax, { forest: forest(c.max_forest) }));
  }
  return parts.length === 0 ? F.climateAny : parts.join(', ');
}

const separationText = (structure: GuideStructure): string =>
  structure.separation === 1 ? F.separationOne : format(F.separation, { separation: structure.separation });

const variantsText = (structure: GuideStructure): string =>
  structure.variants.length === 1
    ? (structure.variants[0]?.name ?? '')
    : structure.variants.map((variant) => format(F.variantWeight, variant)).join(', ');

function structureOverworldTable(): SiteTable {
  const rows = guideStructures()
    .filter((structure) => structure.dimension === 'overworld')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (structure): SiteTableRow => ({
        id: `structure-${structure.id.replace(/[^a-z0-9]+/g, '-')}`,
        cells: [
          text(structure.name),
          text(variantsText(structure)),
          text(format(F.spacing, { spacing: structure.spacing })),
          text(separationText(structure)),
          text(climateText(structure)),
          text(structure.heights.length === 0 ? F.groundAny : structure.heights.map((h) => format(F.groundHeight, h)).join(', ')),
          text(formatList(structure.biomes)),
        ],
      }),
    );
  return { id: 'structuresOverworld', ...enGuides.tables.structuresOverworld, rows, filterable: true };
}

function structureAvoidTable(): SiteTable {
  const lists = new Map<string, { biomes: readonly string[]; uses: Map<number, string[]> }>();
  for (const structure of guideStructures()) {
    if (structure.dimension !== 'overworld') continue;
    for (const avoid of structure.avoids) {
      const key = avoid.biomes.join(',');
      const list = lists.get(key) ?? { biomes: avoid.biomes, uses: new Map<number, string[]>() };
      const names = list.uses.get(avoid.radius) ?? [];
      if (!names.includes(structure.name)) names.push(structure.name);
      list.uses.set(avoid.radius, names);
      lists.set(key, list);
    }
  }
  const rows = [...lists.values()]
    .sort((a, b) => a.biomes.length - b.biomes.length)
    .map(
      (list): SiteTableRow => ({
        cells: [
          text(formatList([...list.biomes].sort())),
          text(
            [...list.uses]
              .sort((a, b) => b[0] - a[0])
              .map(([radius, names]) => format(F.avoidRadius, { radius, structures: formatList(names.sort()) }))
              .join('; '),
          ),
        ],
      }),
    );
  return { id: 'structuresAvoid', ...enGuides.tables.structuresAvoid, rows, filterable: false };
}

function structureElsewhereTable(): SiteTable {
  const dims: Readonly<Record<string, string>> = en.dimensionNames;
  const rows = guideStructures()
    .filter((structure) => structure.dimension !== 'overworld')
    .map(
      (structure): SiteTableRow => ({
        cells: [
          text(structure.name),
          text(dims[structure.dimension] ?? structure.dimension),
          text(format(F.spacing, { spacing: structure.spacing })),
          text(separationText(structure)),
          text(structure.keepsClearOf === null ? F.none : format(F.keepsClear, structure.keepsClearOf)),
          text(formatList(structure.biomes)),
        ],
      }),
    );
  return { id: 'structuresElsewhere', ...enGuides.tables.structuresElsewhere, rows, filterable: false };
}

// --- Dimensions ---------------------------------------------------------------------------------

function dimensionTable(): SiteTable {
  const rows = guideDimensions().map(
    (dim): SiteTableRow => ({
      cells: [
        { parts: [{ text: dim.name, anchor: dim.id }] },
        text(dim.veins.length === 0 ? F.none : count(dim.veins.length)),
        text(dim.structures.length === 0 ? F.none : formatList(dim.structures.map((s) => s.name))),
        text(formatList(dim.biomes)),
      ],
    }),
  );
  return { id: 'dimensions', ...enGuides.tables.dimensions, rows, filterable: false };
}

// --- All of them --------------------------------------------------------------------------------

function buildTable(id: GuideTableId): SiteTable {
  switch (id) {
    case 'tfgVeins':
    case 'tfcVeins':
    case 'beneathVeins':
    case 'moonVeins':
    case 'marsVeins':
    case 'venusVeins':
      return veinTable(id, VEIN_TABLE_SETS[id]);
    case 'tfgMaterials':
      return materialTable(id, 'tfg');
    case 'tfcMaterials':
      return materialTable(id, 'tfc');
    case 'tfgBiomeGroups':
      return biomeGroupTable();
    case 'rocks':
      return rockTable();
    case 'rockLayers':
      return rockLayerTable();
    case 'rockStarts':
      return rockStartTable();
    case 'anvilActions':
      return anvilActionTable();
    case 'anvilExample':
      return anvilExampleTable();
    case 'anvilTiers':
      return anvilTierTable();
    case 'anvilRecipes':
      return anvilRecipeTable();
    case 'structuresOverworld':
      return structureOverworldTable();
    case 'structuresAvoid':
      return structureAvoidTable();
    case 'structuresElsewhere':
      return structureElsewhereTable();
    case 'dimensions':
      return dimensionTable();
  }
}

const CACHE = new Map<GuideTableId, SiteTable>();

export function guideTable(id: GuideTableId): SiteTable {
  const cached = CACHE.get(id);
  if (cached) return cached;
  const built = buildTable(id);
  CACHE.set(id, built);
  return built;
}
