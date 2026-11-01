/**
 * How a deposit kind looks on the map: its fill colour, its marker shape, and the category and
 * material family behind them, chosen per profile so TFC and TFG each get a palette sized to their
 * own set of veins (a player's request, 2026-10-29: "it really needs more distinguishable colors
 * ... maybe you need to use different palettes for TFC and TFG").
 *
 * Two visual channels, so colour alone never has to separate a whole dimension's veins:
 * - shape encodes the deposit category (`CATEGORY_SHAPE`);
 * - colour encodes the material family, with shade variants for kinds of the same family.
 *
 * The data is `src/data/palettes/tfc-1.20-ores.json` and `tfg-ores.json` (one TFG file serves every
 * TFG dimension: vein ids are unique across them). Each entry gives a canonical vein id its family
 * (the vein's main yield), its category and its fill; the files' `_meta` states the rules, and
 * tests/unit/deposit-style.test.ts holds them to the yields the map shows and to the distance
 * floors that make them distinguishable, normal vision and red-green colour blindness alike.
 * `tools/ore-palettes.mjs` proposes and measures the colours; the JSON is the source of truth.
 *
 * The colours are theme-independent; the marker's two-tone ring keeps them legible on both themes
 * and over every raster layer. This is our own UI design choice, not a port of anything.
 *
 * The exported names and types below are the contract between the palette (this module and
 * `src/data/palettes/*-ores.json`) and its consumers (the painter and the filter swatches).
 */
import type { ProfileId } from '@worldgen/api/types';
import { veinFilterId } from '@worldgen/api/types';
import tfcOres from '@data/palettes/tfc-1.20-ores.json';
import tfgOres from '@data/palettes/tfg-ores.json';

/** What a deposit is, for the player: decides the marker shape. */
export type DepositCategory = 'metal' | 'gem' | 'mineral' | 'fuel';

/** The four marker shapes the painter and the swatches can draw. */
export type DepositShape = 'circle' | 'diamond' | 'square' | 'triangle';

/** One shape per category. */
export const CATEGORY_SHAPE: Readonly<Record<DepositCategory, DepositShape>> = {
  metal: 'circle',
  gem: 'diamond',
  mineral: 'square',
  fuel: 'triangle',
};

export interface DepositStyle {
  /** Fill, packed 0xRRGGBB, the same in both themes. */
  readonly color: number;
  readonly category: DepositCategory;
  /** `CATEGORY_SHAPE[category]`, precomputed. */
  readonly shape: DepositShape;
  /** Material family the colour encodes, e.g. `malachite`; kinds of one family share a hue. */
  readonly family: string;
}

/** One entry of a palette file, as written. */
interface PaletteEntry {
  readonly category: string;
  readonly family: string;
  readonly color: string;
}

interface PaletteFile {
  /** The style of an id the file does not list: a neutral grey, never a guess at a family. */
  readonly _fallback: PaletteEntry;
  readonly ores: Readonly<Record<string, PaletteEntry>>;
}

interface Palette {
  readonly styles: ReadonlyMap<string, DepositStyle>;
  readonly fallback: DepositStyle;
}

const CATEGORIES: readonly DepositCategory[] = ['metal', 'gem', 'mineral', 'fuel'];
const HEX_COLOR = /^#[0-9a-f]{6}$/;

/**
 * Parsed once at module load. A malformed entry throws: the files are committed data, checked by the
 * test, and a palette that silently painted some kind grey would hide exactly the bug it exists for.
 */
function toStyle(entry: PaletteEntry, where: string): DepositStyle {
  if (!HEX_COLOR.test(entry.color)) {
    throw new Error(`${where}: colour "${entry.color}" is not "#rrggbb"`);
  }
  const category = CATEGORIES.find((candidate) => candidate === entry.category);
  if (category === undefined) throw new Error(`${where}: unknown category "${entry.category}"`);
  return Object.freeze({
    color: Number.parseInt(entry.color.slice(1), 16),
    category,
    shape: CATEGORY_SHAPE[category],
    family: entry.family,
  });
}

function loadPalette(file: PaletteFile, profile: ProfileId): Palette {
  const styles = new Map<string, DepositStyle>();
  for (const [id, entry] of Object.entries(file.ores)) {
    styles.set(id, toStyle(entry, `${profile}-ores.json ${id}`));
  }
  return { styles, fallback: toStyle(file._fallback, `${profile}-ores.json _fallback`) };
}

const TFC_ORES: PaletteFile = tfcOres;
const TFG_ORES: PaletteFile = tfgOres;
const TFC_PALETTE = loadPalette(TFC_ORES, 'tfc-1.20');

const PALETTES: ReadonlyMap<ProfileId, Palette> = new Map<ProfileId, Palette>([
  ['tfc-1.20', TFC_PALETTE],
  ['tfg', loadPalette(TFG_ORES, 'tfg')],
]);

/** For the profiles that have no palette yet (tfc-1.18, vanilla): the base profile's grey. */
const DEFAULT_FALLBACK: DepositStyle = TFC_PALETTE.fallback;

/**
 * Raw `ore` string -> style, per profile. After the first call for a given string the lookup is two
 * `Map.get`s: no regex, no string building, no allocation. The strings come from a bounded set (each
 * vein id, namespaced or bare), but the cap keeps an unexpected caller from growing it forever.
 */
const CACHE = new Map<ProfileId, Map<string, DepositStyle>>();
const CACHE_LIMIT = 4096;

/**
 * The style of one deposit kind. `ore` is a deposit's `ore` or a filter id, with or without its
 * namespace (normalised with `veinFilterId`, the same canonical id the ore filter uses). Called once
 * per marker per frame, so it must stay an O(1) lookup that allocates nothing.
 *
 * A profile with no palette, or an id its palette does not list, gets that palette's neutral
 * `_fallback` rather than an error: the map still draws the marker, in a colour that claims nothing.
 */
export function depositStyle(profile: ProfileId, ore: string): DepositStyle {
  let byOre = CACHE.get(profile);
  if (byOre === undefined) {
    byOre = new Map();
    CACHE.set(profile, byOre);
  }
  const cached = byOre.get(ore);
  if (cached !== undefined) return cached;
  const palette = PALETTES.get(profile);
  const style =
    palette?.styles.get(veinFilterId(ore).toLowerCase()) ?? palette?.fallback ?? DEFAULT_FALLBACK;
  if (byOre.size < CACHE_LIMIT) byOre.set(ore, style);
  return style;
}
