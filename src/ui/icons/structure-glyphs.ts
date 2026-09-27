/**
 * Map marker glyphs and colours for structure kinds — one kind per structure set, keyed by set id
 * (`src/data/tfg/structures.json`). A marker's feature id is `<set id>@<chunkX>,<chunkZ>`.
 *
 * Same rules as `./glyphs.ts`: integer points on a 16x16 grid, straight edges only, even-odd fill,
 * original artwork (AGENTS.md section 8). Colours are theme token names, never hex (ADR 0005).
 */
import { GLYPHS, type Glyph } from './glyphs';

export interface StructureKind {
  readonly glyph: Glyph;
  /** Theme colour token the marker is filled with. */
  readonly colour: string;
}

const DOOR: readonly number[] = [7, 11, 9, 11, 9, 15, 7, 15];

export const STRUCTURE_KINDS: Readonly<Record<string, StructureKind>> = {
  'tfg:aqueduct/aqueduct': {
    colour: 'wp-blue',
    glyph: [
      [1, 3, 15, 3, 15, 6, 1, 6],
      [2, 6, 4, 6, 4, 14, 2, 14],
      [7, 6, 9, 6, 9, 14, 7, 14],
      [12, 6, 14, 6, 14, 14, 12, 14],
    ],
  },
  'tfg:illagers/arabic_village': {
    colour: 'wp-orange',
    glyph: [[3, 15, 3, 8, 5, 6, 8, 5, 11, 6, 13, 8, 13, 15], DOOR],
  },
  'tfg:illagers/illager_camps': {
    colour: 'wp-red',
    glyph: [
      [8, 2, 15, 14, 1, 14],
      [7, 9, 9, 9, 10, 14, 6, 14],
    ],
  },
  'tfg:illagers/illager_forest_roaming': {
    colour: 'wp-red',
    glyph: [
      [3, 1, 5, 1, 5, 15, 3, 15],
      [5, 2, 13, 2, 13, 9, 9, 7, 5, 9],
    ],
  },
  'tfg:illagers/malay_village': {
    colour: 'wp-orange',
    glyph: [
      [1, 7, 8, 2, 15, 7],
      [3, 7, 13, 7, 13, 11, 3, 11],
      [3, 11, 5, 11, 5, 15, 3, 15],
      [11, 11, 13, 11, 13, 15, 11, 15],
    ],
  },
  'tfg:illagers/norse_village': {
    colour: 'wp-orange',
    glyph: [
      [1, 14, 1, 8, 8, 2, 15, 8, 15, 14],
      [7, 10, 9, 10, 9, 14, 7, 14],
    ],
  },
  'tfg:illagers/yurts_village': {
    colour: 'wp-orange',
    glyph: [
      [1, 14, 1, 9, 4, 6, 12, 6, 15, 9, 15, 14],
      [7, 10, 9, 10, 9, 14, 7, 14],
      [7, 4, 9, 4, 9, 6, 7, 6],
    ],
  },
  'tfg:mineshaft/mineshaft': { colour: 'value', glyph: GLYPHS.mine },
  'tfg:ocean/ocean_moai': {
    colour: 'wp-blue',
    glyph: [
      [4, 15, 4, 6, 5, 2, 11, 2, 12, 6, 12, 15],
      [5, 6, 11, 6, 11, 7, 5, 7],
      [7, 8, 9, 8, 9, 11, 7, 11],
    ],
  },
  'tfg:temperate/plains_temperate_house': { colour: 'wp-green', glyph: GLYPHS.house },
  // --- the Beneath ---------------------------------------------------------------------------
  // A tapering tower: TerraFirmaGreg's one Beneath structure, and it is a tower.
  'tfg:beneath/tower': {
    colour: 'wp-red',
    glyph: [[5, 15, 5, 4, 7, 1, 9, 1, 11, 4, 11, 15], [6, 6, 10, 6, 10, 8, 6, 8]],
  },

  // --- the Moon ------------------------------------------------------------------------------
  // A dome on legs, which is what a moonbase looks like from above a crater rim.
  'tfg:moon/moonbase': {
    colour: 'wp-blue',
    glyph: [
      [3, 12, 3, 8, 5, 5, 8, 4, 11, 5, 13, 8, 13, 12],
      [1, 12, 15, 12, 15, 14, 1, 14],
      [7, 8, 9, 8, 9, 12, 7, 12],
    ],
  },
  // An impact: the crater lip, with the streaks thrown out of it.
  'tfg:moon/meteors': {
    colour: 'wp-orange',
    glyph: [
      [2, 11, 5, 8, 11, 8, 14, 11, 11, 14, 5, 14],
      [7, 1, 9, 1, 9, 6, 7, 6],
      [1, 3, 3, 1, 6, 5, 4, 6],
      [15, 3, 13, 1, 10, 5, 12, 6],
    ],
  },
  // Holes in a wheel of cheese. The pack named it; the marker may as well say so.
  'tfg:moon/cheese_ores': {
    colour: 'wp-pink',
    glyph: [
      [2, 13, 2, 5, 6, 2, 14, 2, 14, 10, 10, 13],
      [4, 6, 6, 6, 6, 8, 4, 8],
      [8, 5, 11, 5, 11, 8, 8, 8],
      [7, 10, 9, 10, 9, 12, 7, 12],
    ],
  },
  // A burrow with two ears over it.
  'tfg:moon/moon_rabbit_houses': {
    colour: 'wp-green',
    glyph: [
      [3, 15, 3, 9, 8, 5, 13, 9, 13, 15],
      [5, 8, 6, 2, 8, 2, 7, 8],
      [9, 8, 10, 2, 12, 2, 11, 8],
      [6, 11, 10, 11, 10, 15, 6, 15],
    ],
  },
  'tfc_ruins:ruins': {
    colour: 'wp-purple',
    glyph: [[1, 14, 1, 6, 3, 6, 3, 8, 5, 8, 5, 4, 7, 4, 7, 9, 9, 9, 9, 6, 11, 6, 11, 10, 13, 10, 13, 7, 15, 7, 15, 14]],
  },
  'tfc_ruined_world:ancient_monument_1': {
    colour: 'wp-purple',
    glyph: [
      [2, 14, 2, 6, 5, 5, 5, 14],
      [7, 14, 7, 3, 9, 2, 10, 3, 10, 14],
      [11, 14, 11, 6, 14, 7, 14, 14],
    ],
  },
  'tfc_ruined_world:limestone_church': {
    colour: 'wp-pink',
    glyph: [
      [3, 15, 3, 9, 8, 5, 13, 9, 13, 15],
      [7, 1, 9, 1, 9, 2, 10, 2, 10, 4, 9, 4, 9, 5, 7, 5, 7, 4, 6, 4, 6, 2, 7, 2],
      DOOR,
    ],
  },
  'tfc_ruined_world:tower_1': {
    colour: 'wp-pink',
    glyph: [
      [4, 15, 4, 5, 3, 5, 3, 1, 5, 1, 5, 3, 7, 3, 7, 1, 9, 1, 9, 3, 11, 3, 11, 1, 13, 1, 13, 5, 12, 5, 12, 15],
      [7, 7, 9, 7, 9, 10, 7, 10],
    ],
  },
  'tfc_ruined_world:towerhouse_1': {
    colour: 'wp-pink',
    glyph: [
      [1, 15, 1, 4, 3, 4, 3, 6, 5, 6, 5, 4, 7, 4, 7, 6, 9, 6, 9, 4, 11, 4, 11, 6, 13, 6, 13, 4, 15, 4, 15, 15],
      [6, 10, 10, 10, 10, 15, 6, 15],
    ],
  },
};

/** For a set this build does not know — a newer data file, say — rather than no marker at all. */
export const FALLBACK_STRUCTURE_KIND: StructureKind = {
  colour: 'accent',
  glyph: [[8, 1, 15, 8, 8, 15, 1, 8]],
};

export function structureKindFor(setId: string): StructureKind {
  return STRUCTURE_KINDS[setId] ?? FALLBACK_STRUCTURE_KIND;
}

/** The set a structure feature belongs to: the part of its id before `@`. */
export function structureSetOf(featureId: string): string {
  const at = featureId.indexOf('@');
  return at < 0 ? featureId : featureId.slice(0, at);
}
