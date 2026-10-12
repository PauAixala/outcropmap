/**
 * What the guides print, read from the same data files the map and the forge run on, so a guide
 * cannot drift from the tools: every ore vein with its depth, host rock and yield, the rock layers,
 * the anvil's actions and finishing rules, TerraFirmaGreg's structures and its other dimensions.
 * `guide-tables.ts` turns these into the tables on the page; `src/ui/i18n/en-guides.ts` holds the
 * words around them.
 *
 * Nothing here is new game logic. Each derivation restates what a port or the Java already does,
 * and names it: `discVeinBand` (facts.ts), the vein feature's `projectToSurface`, the solver itself.
 * tests/unit/site-guides.test.ts holds them to the data.
 *
 * Relative imports only: vite.config.ts loads this module (tests/unit/site-imports.test.ts).
 */
import tfcVeinsJson from '../../data/tfc-1.20/veins.json';
import tfgVeinsJson from '../../data/tfg/veins.json';
import beneathVeinsJson from '../../data/tfg/veins-nether.json';
import moonVeinsJson from '../../data/tfg/veins-moon.json';
import marsVeinsJson from '../../data/tfg/veins-mars.json';
import venusVeinsJson from '../../data/tfg/veins-venus.json';
import tfgVerificationJson from '../../data/tfg/vein-verification.json';
import tfgKaolinJson from '../../data/tfg/kaolin.json';
import tfcBiomeTagsJson from '../../data/tfc-1.20/biome-tags.json';
import tfgBiomeTagsJson from '../../data/tfg/biome-tags.json';
import tfcRocksJson from '../../data/tfc-1.20/rocks.json';
import rockCategoriesJson from '../../data/tfc-1.20/rock-categories.json';
import tfcAnvilJson from '../../data/tfc-1.20/anvil.json';
import tfcRecipesJson from '../../data/tfc-1.20/anvil-recipes.json';
import tfgRecipesJson from '../../data/tfg/anvil-recipes.json';
import tfgStructuresJson from '../../data/tfg/structures.json';
import beneathJson from '../../data/tfg/dimensions/beneath.json';
import moonJson from '../../data/tfg/dimensions/moon.json';
import marsJson from '../../data/tfg/dimensions/mars.json';
import venusJson from '../../data/tfg/dimensions/venus.json';
import glacioJson from '../../data/tfg/dimensions/glacio.json';
import { en } from '../../ui/i18n/en';
import { enGuideKindNames } from '../../ui/i18n/en-guides';
import { formatBiomeName, formatMaterialName, formatOreName } from '../../ui/i18n/ore-names';
import { structureVariantName } from '../../ui/i18n/structure-names';
import { RELIABILITY_MIN_SAMPLE, UNRELIABLE_PRECISION } from '../../worldgen/api/types';
import {
  TARGET_WORK_MAX,
  TARGET_WORK_MIN,
  WORK_LIMIT,
  WORK_MAX,
  WORK_MIN,
  WORK_START,
  buildActions,
} from '../../forge/model/action-set';
import { parseRule } from '../../forge/model/rule-parser';
import type { ForgeRule } from '../../forge/model/types';
import { solve } from '../../forge/solver/solve';
import { discVeinBand } from './facts';

// --- Raw shapes ---------------------------------------------------------------------------------

interface RawBlockEntry {
  readonly block: string;
  readonly weight?: number;
}

interface RawIndicator {
  readonly rarity?: number;
  readonly depth?: number;
  readonly blocks?: readonly { readonly block: string }[];
}

interface RawVein {
  readonly type: string;
  readonly random_name?: string;
  readonly rarity?: number | null;
  readonly size?: number | null;
  readonly height?: number | null;
  readonly radius?: number | null;
  readonly density?: number | null;
  readonly min_y?: number | null;
  readonly max_y?: number | null;
  readonly project?: boolean;
  readonly near_lava?: boolean;
  readonly biomes?: string;
  readonly indicator?: RawIndicator | null;
  readonly blocks?: Readonly<Record<string, readonly RawBlockEntry[]>>;
}

type RawVeinTable = Readonly<Record<string, RawVein>>;

const table = (json: unknown): RawVeinTable => (json as { veins: RawVeinTable }).veins;

// --- Ore veins ----------------------------------------------------------------------------------

/** The vein tables the guides list: TFC's overworld, and TerraFirmaGreg's five dimensions. */
export type VeinSetId = 'tfc' | 'tfg' | 'beneath' | 'moon' | 'mars' | 'venus';

const VEIN_TABLES: Readonly<Record<VeinSetId, RawVeinTable>> = {
  tfc: table(tfcVeinsJson),
  tfg: table(tfgVeinsJson),
  beneath: table(beneathVeinsJson),
  moon: table(moonVeinsJson),
  mars: table(marsVeinsJson),
  venus: table(venusVeinsJson),
};

/** Each set's biome tags, for veins that only form in some biomes. */
const BIOME_TAGS: Readonly<Record<VeinSetId, Readonly<Record<string, readonly string[]>>>> = {
  tfc: (tfcBiomeTagsJson as { tags: Record<string, readonly string[]> }).tags,
  tfg: (tfgBiomeTagsJson as { tags: Record<string, readonly string[]> }).tags,
  beneath: (tfgBiomeTagsJson as { tags: Record<string, readonly string[]> }).tags,
  moon: {},
  mars: {},
  venus: {},
};

export type VeinShape = 'cluster' | 'disc' | 'pipe';

/** One rock a vein can replace, as the guides name it. */
export interface HostRock {
  /** `granite`, `tuff`, `black_sand`, `moon_deepslate`. */
  readonly id: string;
  readonly name: string;
  /** One of TerraFirmaCraft's twenty raw rocks (`tfc:rock/raw/<id>`), not vanilla or modded stone. */
  readonly tfcRock: boolean;
}

/** What share of a vein's ore blocks is one material, in 0..1. */
export interface GuideYield {
  readonly material: string;
  readonly name: string;
  readonly share: number;
  /**
   * TerraFirmaCraft's own ores come in three grades; their split within this material, in 0..1.
   * Null where the blocks carry no grade (every GregTech ore, and TFC's gems and minerals).
   */
  readonly grades: { readonly poor: number; readonly normal: number; readonly rich: number } | null;
  /** TFC's ore deposits (`tfc:deposit/<ore>/<rock>`): placer gravel, not ore blocks. */
  readonly deposit: boolean;
}

export interface GuideVein {
  /** The key in the vein table, e.g. `deep_galena`; unique within a set. */
  readonly key: string;
  /** The id the map's ore filter shows the vein under (`veinFilterId` of its `DepositFeature.ore`). */
  readonly filterId: string;
  readonly name: string;
  readonly shape: VeinShape;
  /**
   * The heights the vein's blocks can occupy. `VeinFeature#place` clips every vein to
   * `[min_y, max_y]`; a disc's own band is narrower (`discVeinBand`).
   */
  readonly minY: number;
  readonly maxY: number;
  /** `project: true`: the band is measured from the surface (`VeinFeature#place`, `projectedY`). */
  readonly projected: boolean;
  /** One chunk in `rarity` rolls the vein (`VeinFeature#getVeinsAtChunk`). */
  readonly rarity: number;
  readonly size: number | null;
  readonly height: number | null;
  readonly radius: number | null;
  readonly hosts: readonly HostRock[];
  readonly yields: readonly GuideYield[];
  /** The biome tag the vein is limited to, and its biomes' names; null when it has none. */
  readonly biomeTag: string | null;
  readonly biomes: readonly string[];
  /** `near_lava: true`: only columns with lava nearby get any ore. */
  readonly nearLava: boolean;
  /**
   * Above-ground indicators: they spawn only when the ore lies less than `depth` blocks below the
   * surface (`VeinFeature#place`). Null when the vein has none (no indicator, or rarity 0).
   */
  readonly indicator: { readonly depth: number; readonly blocks: readonly string[] } | null;
  /** How often the map's markers held this vein in a real TerraFirmaGreg world; null if unmeasured. */
  readonly measured: { readonly checked: number; readonly precision: number; readonly hidden: boolean } | null;
}

/** The bare rock id of a block-table key: `tfc:rock/raw/granite` -> `granite`, `tfc:sand/black` -> `black_sand`. */
function hostId(key: string): string {
  const path = key.slice(key.indexOf(':') + 1);
  const parts = path.split('/');
  const last = parts.at(-1) ?? path;
  // `tfc:sand/<colour>`: GregTech names its sand ores after the sand, `black_sand_..._ore`.
  if (parts.length === 2 && parts[0] === 'sand') return `${last}_sand`;
  return last;
}

const titleCase = (id: string): string =>
  id
    .split('_')
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** A host rock's name: TFC's twenty from `en.rockNames`, anything else from its id. */
function hostName(key: string): string {
  const id = hostId(key);
  const rockNames: Readonly<Record<string, string>> = en.rockNames;
  const tfcRock = key.startsWith('tfc:rock/') ? rockNames[id] : undefined;
  if (tfcRock !== undefined) return tfcRock;
  const name = titleCase(id);
  // Vanilla basalt shares its name with TerraFirmaCraft's; both host TerraFirmaGreg veins.
  return key.startsWith('minecraft:') && rockNames[id] !== undefined ? `${name} (vanilla)` : name;
}

interface BlockYield {
  readonly material: string;
  readonly grade: 'poor' | 'normal' | 'rich' | null;
  readonly deposit: boolean;
  /** False when no rock prefix explained the name; see `resolveMaterial`. */
  readonly resolved: boolean;
}

const GRADES = ['poor', 'normal', 'rich'] as const;

/**
 * The material one block places, or null for plain rock (dikes, gravel). The id shapes in play:
 *
 * - TFC ore: `tfc:ore/<grade>_<material>/<rock>` for the graded metal ores, `tfc:ore/<material>/<rock>`
 *   for the rest;
 * - TFC deposit: `tfc:deposit/<material>/<rock>`;
 * - GregTech: `gtceu:<rock>_<material>_ore` and `gtceu:raw_<material>_block`, and vanilla's
 *   `minecraft:raw_<material>_block`. The host rock's own name comes off, then any other rock in
 *   the table (a block can carry a rock the vein does not list, `gtceu:tuff_coal_ore`).
 *
 * The same split as the map's `veinMaterialMix` (src/worldgen/tfc-1.20/features/vein-materials.ts),
 * plus the grade and deposit shapes and the sand hosts, which the guides name separately.
 *
 * GregTech does not always name an ore after the block it replaces: in the Beneath, blackstone and
 * magma hold `gtceu:pyroxenite_<material>_ore` and dripstone `gtceu:dripstone_<material>_ore`. A
 * name no rock prefix explains comes back unresolved, and `resolveMaterial` matches it against the
 * materials the rest of the set names plainly.
 */
function blockYield(block: string, host: string, rocks: ReadonlySet<string>): BlockYield | null {
  const path = block.slice(block.indexOf(':') + 1);
  if (path.startsWith('rock/')) return null;
  const [kind, middle] = path.split('/');
  if ((kind === 'ore' || kind === 'deposit') && middle !== undefined) {
    if (kind === 'deposit') return { material: middle, grade: null, deposit: true, resolved: true };
    for (const grade of GRADES) {
      if (middle.startsWith(`${grade}_`)) {
        return { material: middle.slice(grade.length + 1), grade, deposit: false, resolved: true };
      }
    }
    return { material: middle, grade: null, deposit: false, resolved: true };
  }
  const last = path.split('/').at(-1) ?? path;
  // A raw ore block names its material and nothing else: `raw_alunite_block`.
  const raw = last.startsWith('raw_');
  let name = last.replace(/^raw_/, '').replace(/_(ore|block)$/, '');
  let resolved = raw;
  if (name.startsWith(`${host}_`)) {
    name = name.slice(host.length + 1);
    resolved = true;
  } else {
    // Longest first, so `black_sand_` wins over a shorter rock that happens to prefix it.
    for (const other of [...rocks].sort((a, b) => b.length - a.length)) {
      if (name.startsWith(`${other}_`) && name.length > other.length + 1) {
        name = name.slice(other.length + 1);
        resolved = true;
        break;
      }
    }
  }
  return name === '' ? null : { material: name, grade: null, deposit: false, resolved };
}

/**
 * The material an unresolved GregTech name ends with, longest first: `pyroxenite_bismuth` ->
 * `bismuth`, `dripstone_rock_salt` -> `rock_salt` (not `salt`). A name that ends with no known
 * material stays as it is, which shows rather than hides a shape this does not know.
 */
function resolveMaterial(found: BlockYield, known: ReadonlySet<string>): string {
  if (found.resolved) return found.material;
  let best: string | null = null;
  for (const material of known) {
    if (found.material.endsWith(`_${material}`) && (best === null || material.length > best.length)) {
      best = material;
    }
  }
  return best ?? found.material;
}

/** The materials a set names plainly: raw ore blocks, and ores whose rock prefix came off. */
function knownMaterials(veins: RawVeinTable, rocks: ReadonlySet<string>): ReadonlySet<string> {
  const known = new Set<string>();
  for (const vein of Object.values(veins)) {
    for (const [key, entries] of Object.entries(vein.blocks ?? {})) {
      for (const entry of entries) {
        const found = blockYield(entry.block, hostId(key), rocks);
        if (found?.resolved) known.add(found.material);
      }
    }
  }
  return known;
}

/**
 * How a vein's ore blocks split between materials, biggest first. TFC picks one entry per block by
 * weight within the host rock's list, so a material's share is its weight over that list's total,
 * averaged over the host rocks; plain rock is left out of the total. Grades and deposits are kept
 * apart inside each material.
 */
function veinYields(
  blocks: Readonly<Record<string, readonly RawBlockEntry[]>>,
  rocks: ReadonlySet<string>,
  known: ReadonlySet<string>,
): GuideYield[] {
  interface Sum {
    share: number;
    grades: { poor: number; normal: number; rich: number };
    graded: number;
  }
  const sums = new Map<string, Sum>();
  let hosts = 0;
  for (const [key, entries] of Object.entries(blocks)) {
    const host = hostId(key);
    const named = entries.flatMap((entry) => {
      const found = blockYield(entry.block, host, rocks);
      return found === null
        ? []
        : [{ ...found, material: resolveMaterial(found, known), weight: entry.weight ?? 1 }];
    });
    const total = named.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) continue;
    hosts++;
    for (const entry of named) {
      const id = entry.deposit ? `${entry.material}#deposit` : entry.material;
      const sum = sums.get(id) ?? { share: 0, grades: { poor: 0, normal: 0, rich: 0 }, graded: 0 };
      sum.share += entry.weight / total;
      if (entry.grade !== null) {
        sum.grades[entry.grade] += entry.weight / total;
        sum.graded += entry.weight / total;
      }
      sums.set(id, sum);
    }
  }
  if (hosts === 0) return [];
  return [...sums]
    .map(([id, sum]): GuideYield => {
      const deposit = id.endsWith('#deposit');
      const material = deposit ? id.slice(0, -'#deposit'.length) : id;
      const graded = sum.graded > 0 && Math.abs(sum.graded - sum.share) < 1e-9;
      return {
        material,
        name: formatMaterialName(material),
        share: sum.share / hosts,
        grades: graded
          ? {
              poor: sum.grades.poor / sum.share,
              normal: sum.grades.normal / sum.share,
              rich: sum.grades.rich / sum.share,
            }
          : null,
        deposit,
      };
    })
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
}

/** Every bare rock id any vein of a set names, for the cross-prefixed GregTech blocks. */
function rocksOf(veins: RawVeinTable): ReadonlySet<string> {
  const rocks = new Set<string>();
  for (const vein of Object.values(veins)) {
    for (const key of Object.keys(vein.blocks ?? {})) rocks.add(hostId(key));
  }
  return rocks;
}

interface Measured {
  readonly checked: number;
  readonly real: number;
  readonly precision: number;
}

const MEASURED: Readonly<Record<string, Measured>> = (
  tfgVerificationJson as { veins: Record<string, Measured> }
).veins;

function measuredFor(set: VeinSetId, filterId: string): GuideVein['measured'] {
  if (set === 'tfc') return null;
  const entry = MEASURED[filterId];
  if (entry === undefined || entry.checked < RELIABILITY_MIN_SAMPLE) return null;
  return {
    checked: entry.checked,
    precision: entry.precision,
    hidden: entry.precision < UNRELIABLE_PRECISION,
  };
}

function biomesFor(set: VeinSetId, tag: string | undefined): readonly string[] {
  if (tag === undefined) return [];
  const members = BIOME_TAGS[set][tag.replace(/^#/, '')] ?? [];
  return members.map(formatBiomeName);
}

/** `tfc:ore/small_native_copper` -> `small_native_copper`; `minecraft:tuff` -> `tuff`. */
function bareId(id: string): string {
  const last = id.slice(id.lastIndexOf('/') + 1);
  return last.slice(last.indexOf(':') + 1);
}

function indicatorOf(raw: RawIndicator | null | undefined): GuideVein['indicator'] {
  if (!raw || typeof raw.depth !== 'number' || typeof raw.rarity !== 'number' || raw.rarity <= 0) {
    return null;
  }
  return {
    depth: raw.depth,
    // TerraFirmaCraft's own indicator blocks read as names ("Small Native Copper", "Blood Lily");
    // GregTech's are named after their ore, which the row already says.
    blocks: (raw.blocks ?? [])
      .filter((entry) => entry.block.startsWith('tfc:'))
      .map((entry) => formatMaterialName(bareId(entry.block))),
  };
}

const KAOLIN = 'kaolin';

/**
 * TerraFirmaGreg's kaolin is not in its vein table's tag list: the map reads it from the installed
 * pack's own feature and biome list (`src/data/tfg/kaolin.json`), and so does this. The feature's
 * type sits beside its config there, `tfc:kaolin_disc_vein`.
 */
function tfgKaolinVein(): RawVein {
  // `blocks` is an empty list there: the kaolin feature has its own replacements (grass, dirt,
  // gravel, raw rock, and mud in TerraFirmaGreg), not a table of host rocks.
  const config = (tfgKaolinJson as unknown as { configuredFeature: { config: Omit<RawVein, 'type' | 'blocks'> } })
    .configuredFeature.config;
  return { ...config, type: 'kaolin_disc' };
}

function guideVein(
  set: VeinSetId,
  key: string,
  raw: RawVein,
  rocks: ReadonlySet<string>,
  known: ReadonlySet<string>,
): GuideVein | null {
  const shape: VeinShape | null =
    raw.type === 'cluster' ? 'cluster' : raw.type === 'pipe' ? 'pipe' : raw.type === 'disc' || raw.type === 'kaolin_disc' ? 'disc' : null;
  if (shape === null || typeof raw.rarity !== 'number' || typeof raw.min_y !== 'number' || typeof raw.max_y !== 'number') {
    return null;
  }
  const kaolin = raw.type === 'kaolin_disc';
  const yields = kaolin
    ? [{ material: KAOLIN, name: formatMaterialName(KAOLIN), share: 1, grades: null, deposit: false }]
    : veinYields(raw.blocks ?? {}, rocks, known);
  // Dikes and gravel place plain rock: not an ore vein.
  if (yields.length === 0) return null;
  const filterId = shape === 'cluster' ? key : (raw.random_name ?? key);
  const band =
    shape === 'disc' && typeof raw.size === 'number' && typeof raw.height === 'number'
      ? discVeinBand({ minY: raw.min_y, maxY: raw.max_y, size: raw.size, height: raw.height })
      : { minY: raw.min_y, maxY: raw.max_y };
  const kaolinBiomes =
    kaolin && set === 'tfg'
      ? (tfgKaolinJson as { biomes: readonly string[] }).biomes.filter((id) => id.startsWith('tfg:')).map(formatBiomeName)
      : null;
  return {
    key,
    filterId,
    name: formatOreName(filterId),
    shape,
    minY: band.minY,
    maxY: band.maxY,
    projected: raw.project === true,
    rarity: raw.rarity,
    size: typeof raw.size === 'number' ? raw.size : null,
    height: typeof raw.height === 'number' ? raw.height : null,
    radius: typeof raw.radius === 'number' ? raw.radius : null,
    hosts: Object.keys(raw.blocks ?? {})
      .map((hostKey) => ({ id: hostId(hostKey), name: hostName(hostKey), tfcRock: hostKey.startsWith('tfc:rock/raw/') }))
      .filter((host, index, all) => all.findIndex((other) => other.name === host.name) === index)
      .sort((a, b) => a.name.localeCompare(b.name)),
    yields,
    biomeTag: raw.biomes ?? null,
    biomes: kaolinBiomes ?? biomesFor(set, raw.biomes),
    nearLava: raw.near_lava === true,
    indicator: indicatorOf(raw.indicator),
    measured: measuredFor(set, filterId),
  };
}

const VEIN_CACHE = new Map<VeinSetId, readonly GuideVein[]>();

/** Every vein of a set that places ore, by name. */
export function guideVeins(set: VeinSetId): readonly GuideVein[] {
  const cached = VEIN_CACHE.get(set);
  if (cached) return cached;
  const raw = VEIN_TABLES[set];
  const rocks = rocksOf(raw);
  const known = knownMaterials(raw, rocks);
  const veins = Object.entries(raw).flatMap(([key, vein]) => {
    // TerraFirmaGreg's table names kaolin by a tag the pack resolves itself; use the pack's list.
    const source = set === 'tfg' && vein.type === 'kaolin_disc' ? tfgKaolinVein() : vein;
    const built = guideVein(set, key, source, rocks, known);
    return built === null ? [] : [built];
  });
  veins.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  VEIN_CACHE.set(set, veins);
  return veins;
}

/** The table keys of a set's veins that place no ore at all (dikes, gravel), for the text. */
export function rockOnlyVeins(set: VeinSetId): readonly string[] {
  const listed = new Set(guideVeins(set).map((vein) => vein.key));
  return Object.keys(VEIN_TABLES[set]).filter((key) => !listed.has(key)).sort();
}

/** One material and every vein that yields it, richest first. */
export interface MaterialSource {
  readonly material: string;
  readonly name: string;
  readonly sources: readonly { readonly vein: GuideVein; readonly share: number; readonly deposit: boolean }[];
}

/** For each material of a set: which veins yield it. Answers "where is silver?". */
export function materialIndex(set: VeinSetId): readonly MaterialSource[] {
  const index = new Map<string, MaterialSource['sources'][number][]>();
  for (const vein of guideVeins(set)) {
    for (const y of vein.yields) {
      const list = index.get(y.material) ?? [];
      list.push({ vein, share: y.share, deposit: y.deposit });
      index.set(y.material, list);
    }
  }
  return [...index]
    .map(([material, sources]) => ({
      material,
      name: formatMaterialName(material),
      sources: sources.sort((a, b) => b.share - a.share || a.vein.name.localeCompare(b.vein.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The biome tags a set's veins are limited to, with the biomes each holds and the veins using it. */
export function veinBiomeGroups(
  set: VeinSetId,
): readonly { readonly tag: string; readonly biomes: readonly string[]; readonly veins: readonly GuideVein[] }[] {
  const groups = new Map<string, GuideVein[]>();
  for (const vein of guideVeins(set)) {
    if (vein.biomeTag === null) continue;
    const list = groups.get(vein.biomeTag) ?? [];
    list.push(vein);
    groups.set(vein.biomeTag, list);
  }
  return [...groups]
    .map(([tag, veins]) => ({ tag, biomes: veins[0]?.biomes ?? [], veins }))
    .sort((a, b) => a.tag.localeCompare(b.tag));
}

// --- Rocks --------------------------------------------------------------------------------------

/** TerraFirmaCraft's twenty rocks, which TerraFirmaGreg's overworld keeps. */
export interface GuideRock {
  readonly id: string;
  readonly name: string;
  /** `RockDisplayCategory`, e.g. "Felsic igneous intrusive". */
  readonly category: string;
}

function sentenceCase(id: string): string {
  const words = id.split('_').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function guideRocks(): readonly GuideRock[] {
  const categories = (rockCategoriesJson as { rocks: Record<string, string> }).rocks;
  const rockNames: Readonly<Record<string, string>> = en.rockNames;
  return Object.entries(categories).map(([id, category]) => ({
    id,
    name: rockNames[id] ?? titleCase(id),
    category: sentenceCase(category),
  }));
}

interface RawRockLayers {
  readonly bottom: readonly string[];
  readonly layers: readonly { readonly id: string; readonly entries: readonly (readonly [string, string])[] }[];
  readonly land: readonly string[];
  readonly oceanFloor: readonly string[];
  readonly volcanic: readonly string[];
  readonly uplift: readonly string[];
}

const ROCK_LAYERS = (tfcRocksJson as unknown as { rockLayers: RawRockLayers }).rockLayers;

/** One layer of the rock tree: each rock it can hold, and the layer that lies under that rock. */
export interface RockLayer {
  readonly id: string;
  readonly entries: readonly { readonly rock: string; readonly below: string }[];
}

/** `rock_layer_settings`: the four starting points, the layers, and the rocks at the bottom. */
export function rockLayerTree(): {
  readonly starts: Readonly<Record<'oceanFloor' | 'volcanic' | 'land' | 'uplift', readonly string[]>>;
  readonly layers: readonly RockLayer[];
  readonly bottom: readonly string[];
} {
  return {
    starts: {
      oceanFloor: ROCK_LAYERS.oceanFloor,
      volcanic: ROCK_LAYERS.volcanic,
      land: ROCK_LAYERS.land,
      uplift: ROCK_LAYERS.uplift,
    },
    layers: ROCK_LAYERS.layers.map((layer) => ({
      id: layer.id,
      entries: layer.entries.map(([rock, below]) => ({ rock, below })),
    })),
    bottom: ROCK_LAYERS.bottom,
  };
}

/** For each of the twenty rocks: the veins of a set that can form in it. */
export function veinsByHostRock(set: 'tfc' | 'tfg'): ReadonlyMap<string, readonly GuideVein[]> {
  const out = new Map<string, GuideVein[]>();
  for (const rock of guideRocks()) out.set(rock.id, []);
  for (const vein of guideVeins(set)) {
    for (const host of vein.hosts) if (host.tfcRock) out.get(host.id)?.push(vein);
  }
  return out;
}

// --- The anvil ----------------------------------------------------------------------------------

/** The eight actions, in the order the forge lists them, with what each does to the work value. */
export function anvilActions(): readonly { readonly key: string; readonly label: string; readonly delta: number }[] {
  const actions = buildActions(tfcAnvilJson.actions);
  return actions.map((action) => ({
    key: action.id,
    label: action.strength !== undefined ? en.forge.hitStrengthNames[action.strength] : en.forge.actionNames[action.type],
    delta: action.delta,
  }));
}

/** The work bar: where the work starts, what destroys the item, and the range of a target. */
export const WORK_BAR = {
  min: WORK_MIN,
  start: WORK_START,
  limit: WORK_LIMIT,
  targetMin: TARGET_WORK_MIN,
  targetMax: TARGET_WORK_MAX,
} as const;

interface RawRecipe {
  readonly id: string;
  readonly recipeId: string;
  readonly input: { readonly tag?: string; readonly item?: string };
  readonly result: { readonly item?: string; readonly count?: number };
  readonly rules: readonly string[];
  readonly tier: number;
}

const TFC_RECIPES = Object.values((tfcRecipesJson as { recipes: Record<string, RawRecipe> }).recipes);
const TFG_RECIPES = Object.values((tfgRecipesJson as { recipes: Record<string, RawRecipe> }).recipes);

/** Where a rule sits among the last three steps, in the order a smith strikes them. */
const SLOT_ORDER: Readonly<Record<ForgeRule['position'], number>> = {
  THIRD_LAST: 0,
  SECOND_LAST: 1,
  LAST: 2,
  NOT_LAST: 3,
  ANY: 4,
};

/**
 * A recipe's rules in the order a smith meets them: third last, second last, last, then the loose
 * ones. The datapack stores them last-first (docs/FORGING-NOTES.md, "Finishing rules read
 * backwards"), which reads as the reverse of what to do.
 */
export function orderedRules(rules: readonly string[]): readonly ForgeRule[] {
  return rules.map(parseRule).sort((a, b) => SLOT_ORDER[a.position] - SLOT_ORDER[b.position]);
}

/** "Hit, last step"; "Draw, not the last step". */
export function ruleLabel(rule: ForgeRule): string {
  const action =
    rule.type === 'HIT'
      ? rule.strength === undefined
        ? en.forge.anyHitName
        : en.forge.hitStrengthNames[rule.strength]
      : en.forge.actionNames[rule.type];
  return `${action}, ${en.forge.positionNames[rule.position]}`;
}

/** One kind of item TerraFirmaCraft smiths from every metal it can, and the rules it shares. */
export interface RecipeGroup {
  /** `pickaxe_head`, or a whole item id for the one-off recipes. */
  readonly kind: string;
  readonly name: string;
  readonly rules: readonly ForgeRule[];
  /** The metals, with the anvil tier each needs, lowest tier first. */
  readonly metals: readonly { readonly metal: string; readonly name: string; readonly tier: number }[];
  /** What goes on the anvil, without the metal: "ingots", "double sheets". */
  readonly inputs: readonly string[];
}

const METAL_ITEM = /^tfc:metal\/([a-z_]+)\/([a-z_]+)$/;
/** `forge:double_sheets/copper`: the form, then the metal. */
const FORGE_TAG = /^forge:([a-z_]+)\/([a-z_]+)$/;

/** The metal a recipe works: its result's, or else its input tag's (`forge:rods/brass`). */
function recipeMetal(recipe: RawRecipe): string | null {
  return METAL_ITEM.exec(recipe.result.item ?? '')?.[2] ?? FORGE_TAG.exec(recipe.input.tag ?? '')?.[2] ?? null;
}

/** What goes on the anvil, without the metal: `forge:double_sheets/copper` -> "double sheets". */
function recipeInput(recipe: RawRecipe): string {
  const tag = FORGE_TAG.exec(recipe.input.tag ?? '');
  if (tag?.[1] !== undefined) return tag[1].replace(/_/g, ' ');
  return bareId(recipe.input.item ?? recipe.input.tag ?? '').replace(/_/g, ' ');
}

/**
 * TerraFirmaCraft's recipes grouped by what they make: every pickaxe head shares one set of rules
 * whatever its metal. Recipes that disagree on their rules land in separate groups, never merged.
 */
export function tfcRecipeGroups(): readonly RecipeGroup[] {
  const groups = new Map<string, { kind: string; rules: readonly ForgeRule[]; recipes: RawRecipe[] }>();
  for (const recipe of TFC_RECIPES) {
    const item = recipe.result.item ?? recipe.id;
    const kind = METAL_ITEM.exec(item)?.[1] ?? bareId(item);
    const key = `${kind}|${recipe.rules.join(',')}`;
    const group = groups.get(key) ?? { kind, rules: orderedRules(recipe.rules), recipes: [] };
    group.recipes.push(recipe);
    groups.set(key, group);
  }
  const kindNames: Readonly<Record<string, string>> = enGuideKindNames;
  return [...groups.values()]
    .map((group): RecipeGroup => {
      const metals = group.recipes
        .flatMap((recipe) => {
          const metal = recipeMetal(recipe);
          return metal === null ? [] : [{ metal, name: formatMaterialName(metal), tier: recipe.tier }];
        })
        .filter((metal, index, all) => all.findIndex((other) => other.metal === metal.metal) === index)
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
      const inputs = [...new Set(group.recipes.map(recipeInput))];
      return {
        kind: group.kind,
        name: kindNames[group.kind] ?? sentenceCase(group.kind),
        rules: group.rules,
        metals,
        inputs,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const anvilRecipeCounts = (): { readonly tfc: number; readonly tfg: number } => ({
  tfc: TFC_RECIPES.length,
  tfg: TFG_RECIPES.length,
});

/**
 * How many of TerraFirmaCraft's recipes TerraFirmaGreg overrides with other rules: same recipe id,
 * a different set of rules (docs/FORGING-NOTES.md, "TerraFirmaGreg recipe catalogue").
 */
export function tfgChangedRuleCount(): number {
  const tfgRules = new Map(TFG_RECIPES.map((recipe) => [recipe.recipeId, [...recipe.rules].sort().join(',')]));
  return TFC_RECIPES.filter((recipe) => {
    const theirs = tfgRules.get(recipe.recipeId);
    return theirs !== undefined && theirs !== [...recipe.rules].sort().join(',');
  }).length;
}

/** How many recipes need each anvil tier, per catalogue. */
export function recipesPerTier(): readonly { readonly tier: number; readonly tfc: number; readonly tfg: number }[] {
  const tiers = new Map<number, { tfc: number; tfg: number }>();
  for (const recipe of TFC_RECIPES) {
    const entry = tiers.get(recipe.tier) ?? { tfc: 0, tfg: 0 };
    entry.tfc++;
    tiers.set(recipe.tier, entry);
  }
  for (const recipe of TFG_RECIPES) {
    const entry = tiers.get(recipe.tier) ?? { tfc: 0, tfg: 0 };
    entry.tfg++;
    tiers.set(recipe.tier, entry);
  }
  return [...tiers].map(([tier, counts]) => ({ tier, ...counts })).sort((a, b) => a.tier - b.tier);
}

/** The recipe the worked example uses, and the target it pretends the anvil shows. */
export const WORKED_EXAMPLE = { recipe: 'copper_pickaxe_head', target: 70 } as const;

/**
 * The worked example, solved by the forge's own solver: a copper pickaxe head with a made-up target.
 * The steps are whatever the solver returns, so the guide and the calculator always agree.
 */
export function workedExample(): {
  readonly recipe: RecipeGroup['name'];
  readonly target: number;
  readonly rules: readonly ForgeRule[];
  readonly steps: readonly { readonly label: string; readonly delta: number; readonly work: number }[];
} {
  const recipe = TFC_RECIPES.find((entry) => entry.id === WORKED_EXAMPLE.recipe);
  if (recipe === undefined) throw new Error(`anvil-recipes.json: no ${WORKED_EXAMPLE.recipe}`);
  const actions = buildActions(tfcAnvilJson.actions);
  const rules = orderedRules(recipe.rules);
  const [best] = solve({
    start: WORK_START,
    target: WORKED_EXAMPLE.target,
    rules,
    actions,
    minValue: WORK_MIN,
    maxValue: WORK_MAX,
    maxSolutions: 1,
  });
  if (best === undefined) throw new Error('worked example: the solver found no sequence');
  let work = WORK_START;
  return {
    recipe: sentenceCase('pickaxe_head'),
    target: WORKED_EXAMPLE.target,
    rules,
    steps: best.steps.map((step) => {
      work += step.delta;
      return {
        label: step.strength !== undefined ? en.forge.hitStrengthNames[step.strength] : en.forge.actionNames[step.type],
        delta: step.delta,
        work,
      };
    }),
  };
}

// --- Structures ---------------------------------------------------------------------------------

interface RawClimate {
  readonly min_temperature?: number;
  readonly max_temperature?: number;
  readonly min_rainfall?: number;
  readonly max_rainfall?: number;
  readonly min_forest?: string;
  readonly max_forest?: string;
}

type RawCondition =
  | { readonly type: 'avoid_biomes'; readonly biomes: readonly string[]; readonly radius: number; readonly step: number; readonly allowedCount: number }
  | { readonly type: 'height'; readonly heightmap: string; readonly min: number; readonly max: number }
  | { readonly type: string };

interface RawStructureSet {
  readonly id: string;
  readonly dimension: string;
  readonly placement: {
    readonly type: string;
    readonly spacing?: number;
    readonly separation?: number;
    readonly exclusionZone?: { readonly otherSet: string; readonly chunkCount: number };
    readonly climate?: RawClimate;
  };
  readonly structures: readonly {
    readonly id: string;
    readonly weight: number;
    readonly biomes: readonly string[];
    readonly conditions: readonly RawCondition[];
  }[];
}

const STRUCTURE_SETS = (tfgStructuresJson as { sets: readonly RawStructureSet[] }).sets;

export interface GuideStructure {
  readonly id: string;
  readonly name: string;
  readonly dimension: string;
  /** One placement chunk per `spacing` × `spacing` chunks, never closer than `separation`. */
  readonly spacing: number;
  readonly separation: number;
  readonly climate: RawClimate | null;
  readonly variants: readonly { readonly name: string; readonly weight: number }[];
  readonly biomes: readonly string[];
  /** Ground height limits (`height` conditions): the surface must lie in [min, max]. */
  readonly heights: readonly { readonly min: number; readonly max: number }[];
  /** Biomes it keeps away from, and how far (blocks, the radius of the sampled square). */
  readonly avoids: readonly { readonly biomes: readonly string[]; readonly radius: number }[];
  readonly keepsClearOf: { readonly set: string; readonly chunks: number } | null;
}

/** Every random-spread structure set TerraFirmaGreg places, per dimension; strongholds excluded. */
export function guideStructures(): readonly GuideStructure[] {
  return STRUCTURE_SETS.filter(
    (set) => set.structures.length > 0 && typeof set.placement.spacing === 'number' && typeof set.placement.separation === 'number',
  ).map((set) => {
    const conditions = set.structures.flatMap((structure) => structure.conditions);
    const heights = conditions.flatMap((condition) =>
      condition.type === 'height' && 'min' in condition ? [{ min: condition.min, max: condition.max }] : [],
    );
    const avoids = conditions.flatMap((condition) =>
      condition.type === 'avoid_biomes' && 'biomes' in condition
        ? [{ biomes: condition.biomes.map(formatBiomeName), radius: condition.radius }]
        : [],
    );
    const unique = <T>(items: readonly T[], key: (item: T) => string): T[] =>
      items.filter((item, index) => items.findIndex((other) => key(other) === key(item)) === index);
    const structureKinds: Readonly<Record<string, string>> = en.structureKinds;
    return {
      id: set.id,
      name: structureKinds[set.id] ?? structureVariantName(set.id),
      dimension: set.dimension,
      spacing: set.placement.spacing ?? 0,
      separation: set.placement.separation ?? 0,
      climate: set.placement.climate ?? null,
      variants: set.structures.map((structure) => ({ name: structureVariantName(structure.id), weight: structure.weight })),
      biomes: [...new Set(set.structures.flatMap((structure) => structure.biomes))].map(formatBiomeName).sort(),
      heights: unique(heights, (h) => `${h.min}..${h.max}`),
      avoids: unique(avoids, (a) => `${a.radius}|${a.biomes.join(',')}`),
      keepsClearOf: set.placement.exclusionZone
        ? { set: structureKinds[set.placement.exclusionZone.otherSet] ?? structureVariantName(set.placement.exclusionZone.otherSet), chunks: set.placement.exclusionZone.chunkCount }
        : null,
    };
  });
}

/** TerraFirmaCraft's forest types, in the order `ForestType` declares them (none to old growth). */
export const FOREST_ORDER = ['none', 'sparse', 'edge', 'normal', 'old_growth'] as const;

// --- Dimensions ---------------------------------------------------------------------------------

export type DimensionId = 'beneath' | 'moon' | 'mars' | 'venus' | 'glacio';

interface RawDimension {
  readonly seaLevel: number;
  readonly minY: number;
  readonly height: number;
  readonly biomes: readonly { readonly biome: string }[];
}

const DIMENSIONS: Readonly<Record<DimensionId, RawDimension>> = {
  beneath: beneathJson as RawDimension,
  moon: moonJson as RawDimension,
  mars: marsJson as RawDimension,
  venus: venusJson as RawDimension,
  glacio: glacioJson as RawDimension,
};

/** The structure-set dimension names `structures.json` uses. */
const STRUCTURE_DIMENSION: Readonly<Record<DimensionId, string>> = {
  beneath: 'nether',
  moon: 'moon',
  mars: 'mars',
  venus: 'venus',
  glacio: 'glacio',
};

export interface GuideDimension {
  readonly id: DimensionId;
  readonly name: string;
  readonly minY: number;
  readonly maxY: number;
  readonly seaLevel: number;
  readonly biomes: readonly string[];
  readonly veins: readonly GuideVein[];
  readonly structures: readonly GuideStructure[];
}

export function guideDimensions(): readonly GuideDimension[] {
  const names: Readonly<Record<string, string>> = en.dimensionNames;
  const veinSets: Readonly<Partial<Record<DimensionId, VeinSetId>>> = {
    beneath: 'beneath',
    moon: 'moon',
    mars: 'mars',
    venus: 'venus',
  };
  return (Object.keys(DIMENSIONS) as DimensionId[]).map((id) => {
    const dim = DIMENSIONS[id];
    const veinSet = veinSets[id];
    return {
      id,
      name: names[id === 'beneath' ? 'nether' : id] ?? titleCase(id),
      minY: dim.minY,
      maxY: dim.minY + dim.height - 1,
      seaLevel: dim.seaLevel,
      biomes: [...new Set(dim.biomes.map((entry) => entry.biome))].map(formatBiomeName).sort(),
      veins: veinSet === undefined ? [] : guideVeins(veinSet),
      structures: guideStructures().filter((structure) => structure.dimension === STRUCTURE_DIMENSION[id]),
    };
  });
}
