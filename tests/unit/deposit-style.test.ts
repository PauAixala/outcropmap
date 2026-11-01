/**
 * The deposit palettes (src/data/palettes/tfc-1.20-ores.json, tfg-ores.json) behind `depositStyle`:
 * that every kind the map can draw has its own style, that families follow the yields the map shows,
 * and that the colours can be told apart where it matters, among the kinds one dimension draws with
 * the same marker shape, for normal vision and for red-green colour blindness.
 *
 * Distances are Euclidean in OKLab (ΔE_OK, Björn Ottosson 2020); colour blindness is simulated with
 * Machado, Oliveira and Fernandes 2009 at severity 1.0 in linear sRGB (src/core/color).
 * `node tools/ore-palettes.mjs` prints the same numbers per group.
 */
import { describe, expect, it } from 'vitest';
import '@worldgen/profiles';
import { getProfile } from '@worldgen/registry';
import { DIMENSION_IDS, type DimensionId, type ProfileId } from '@worldgen/api/types';
import { VEIN_SET_BY_DIMENSION } from '@worldgen/tfg/index';
import {
  CATEGORY_SHAPE,
  depositStyle,
  type DepositCategory,
  type DepositStyle,
} from '@render/deposit-style';
import {
  linearRgbToOklab,
  oklabDistance,
  packedToLinearRgb,
  simulateCvd,
  type Oklab,
} from '@core/color';
import tfcPalette from '@data/palettes/tfc-1.20-ores.json';
import tfgPalette from '@data/palettes/tfg-ores.json';
import tfcVeins from '@data/tfc-1.20/veins.json';
import tfgVeins from '@data/tfg/veins.json';
import tfgBeneathVeins from '@data/tfg/veins-nether.json';
import tfgMoonVeins from '@data/tfg/veins-moon.json';
import tfgMarsVeins from '@data/tfg/veins-mars.json';
import tfgVenusVeins from '@data/tfg/veins-venus.json';

/** The floors no group may go under (the brief's), and the targets every group aims for. */
const FLOOR = { family: 0.08, variant: 0.04, cvd: 0.03 } as const;
const TARGET = { family: 0.1, variant: 0.05, cvd: 0.05 } as const;

/** OKLab lightness band of every fill: below it a fill merges with the marker ring's dark outline. */
const MIN_L = 0.4;
const MAX_L = 0.93;

/**
 * Groups that fall short of a target (never of a floor), with the best value achieved, so a change
 * that makes them worse fails here instead of passing silently.
 *
 * TerraFirmaGreg's overworld metal circles: 49 kinds in 29 families, most of them metal ores whose
 * expected colours are warm (gold, brass chalcopyrite, orange copper, ochre limonite, rust goethite,
 * brown cassiterite, red hematite). Under protanopia and deuteranopia every warm hue collapses onto
 * one yellow-brown strip told apart by lightness alone, so holding those anchors and a 0.05 CVD
 * distance at once is not possible; the floors outrank the anchors and the anchors the targets, so
 * this group keeps the anchors, meets the normal-vision target, and stays above the CVD floor.
 */
const TARGET_SHORTFALLS: Readonly<Record<string, Partial<Record<Measure, number>>>> = {
  // Achieved: protan 0.0453 (normal_iron ~ surface_malachite), deutan 0.0431 (deep_banded_iron ~
  // surface_hematite); normal vision 0.1033 and variants 0.0524 meet their targets.
  'tfg/overworld/metal': { protan: 0.045, deutan: 0.043 },
};

type Measure = 'normal' | 'protan' | 'deutan' | 'variant';

interface PaletteEntry {
  readonly category: string;
  readonly family: string;
  readonly color: string;
}
interface PaletteFile {
  readonly _fallback: PaletteEntry;
  readonly ores: Readonly<Record<string, PaletteEntry>>;
}
interface RawVein {
  readonly type?: string;
  readonly random_name?: string | null;
}
interface VeinFile {
  readonly veins: Readonly<Record<string, RawVein>>;
}

const PALETTES: Readonly<Record<'tfc-1.20' | 'tfg', PaletteFile>> = {
  'tfc-1.20': tfcPalette,
  tfg: tfgPalette,
};
const PALETTE_PROFILES = ['tfc-1.20', 'tfg'] as const;

/** Every vein table each palette must cover, by dimension. */
const VEIN_FILES: Readonly<Record<'tfc-1.20' | 'tfg', Partial<Record<DimensionId, VeinFile>>>> = {
  'tfc-1.20': { overworld: tfcVeins },
  tfg: {
    overworld: tfgVeins,
    nether: tfgBeneathVeins,
    moon: tfgMoonVeins,
    mars: tfgMarsVeins,
    venus: tfgVenusVeins,
  },
};

/** The three rock dikes are vein-table entries but not deposits. */
const DIKES = new Set(['diorite_dike', 'gabbro_dike', 'granite_dike']);

/**
 * Vein-table entries the map does not draw, listed so a change in what is drawable is noticed:
 * `near_lava` veins (TFC's sulfur, TFG's deep_sulfur and deep_copper_sulfide), whose lava gate has no
 * port, and TFG's borrowed gravel disc, which places no ore.
 */
const UNDRAWN: Readonly<Record<'tfc-1.20' | 'tfg', readonly string[]>> = {
  'tfc-1.20': ['sulfur'],
  tfg: ['deep_copper_sulfide', 'deep_sulfur', 'gravel'],
};

/** The id a vein reports (`veinFilterId` of its `ore`): a cluster's key, otherwise its random_name. */
function canonicalId(key: string, vein: RawVein): string {
  return vein.type === 'cluster' ? key : (vein.random_name ?? key);
}

function veinDataIds(profile: 'tfc-1.20' | 'tfg'): string[] {
  return Object.values(VEIN_FILES[profile]).flatMap((file) =>
    Object.entries(file.veins)
      .filter(([key]) => !DIKES.has(key))
      .map(([key, vein]) => canonicalId(key, vein)),
  );
}

/**
 * What one dimension can draw, the way the ore filter lists it (src/ui/components/panels.ts): the
 * profile's per-dimension list, or its whole list when it has none. A profile that keeps
 * per-dimension lists draws nothing in a dimension missing from them (TFG's Glacio has no vein
 * table), where the filter would fall back to the union.
 */
function drawable(profile: ProfileId, dimension: DimensionId): readonly string[] {
  const descriptor = getProfile(profile);
  if (!descriptor.dimensions.includes(dimension)) return [];
  const perDimension = descriptor.dimensionDepositOres;
  if (perDimension === undefined) return [...new Set(descriptor.depositOres ?? [])];
  return [...new Set(perDimension[dimension] ?? [])];
}

/** A colour as seen normally, with protanopia and with deuteranopia. */
function views(color: number): Record<Exclude<Measure, 'variant'>, Oklab> {
  const rgb = packedToLinearRgb(color);
  const protan = simulateCvd('protanopia', rgb.r, rgb.g, rgb.b);
  const deutan = simulateCvd('deuteranopia', rgb.r, rgb.g, rgb.b);
  return {
    normal: linearRgbToOklab(rgb.r, rgb.g, rgb.b),
    protan: linearRgbToOklab(protan.r, protan.g, protan.b),
    deutan: linearRgbToOklab(deutan.r, deutan.g, deutan.b),
  };
}

interface Pair {
  readonly measure: Measure;
  readonly distance: number;
  readonly a: string;
  readonly b: string;
}

interface Group {
  readonly key: string;
  readonly ids: readonly string[];
  readonly families: number;
  /** Every pair's distances, closest first per measure. */
  readonly pairs: readonly Pair[];
}

/** Every (profile, dimension, category) group the map can draw, with all its pair distances. */
function groups(): Group[] {
  const out: Group[] = [];
  for (const profile of PALETTE_PROFILES) {
    for (const dimension of DIMENSION_IDS) {
      const byCategory = new Map<DepositCategory, string[]>();
      for (const id of drawable(profile, dimension)) {
        const { category } = depositStyle(profile, id);
        byCategory.set(category, [...(byCategory.get(category) ?? []), id]);
      }
      for (const [category, ids] of byCategory) {
        const styles = ids.map((id) => depositStyle(profile, id));
        const seen = styles.map((style) => views(style.color));
        const pairs: Pair[] = [];
        for (let i = 0; i < ids.length; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = ids[i]!;
            const b = ids[j]!;
            const u = seen[i]!;
            const v = seen[j]!;
            if (styles[i]!.family === styles[j]!.family) {
              pairs.push({ measure: 'variant', distance: oklabDistance(u.normal, v.normal), a, b });
            } else {
              for (const measure of ['normal', 'protan', 'deutan'] as const) {
                pairs.push({ measure, distance: oklabDistance(u[measure], v[measure]), a, b });
              }
            }
          }
        }
        pairs.sort((x, y) => x.distance - y.distance);
        out.push({
          key: `${profile}/${dimension}/${category}`,
          ids,
          families: new Set(styles.map((style) => style.family)).size,
          pairs,
        });
      }
    }
  }
  return out;
}

const GROUPS = groups();

const limit = (measure: Measure, table: { family: number; variant: number; cvd: number }): number =>
  measure === 'normal' ? table.family : measure === 'variant' ? table.variant : table.cvd;

/** The closest pairs under `bound`, formatted for a failure message. */
function closest(group: Group, measure: Measure, bound: number): string[] {
  return group.pairs
    .filter((pair) => pair.measure === measure && pair.distance < bound)
    .slice(0, 10)
    .map((pair) => `${group.key} ${measure} ${pair.distance.toFixed(4)}: ${pair.a} ~ ${pair.b}`);
}

const minimum = (group: Group, measure: Measure): number =>
  group.pairs.find((pair) => pair.measure === measure)?.distance ?? Infinity;

describe('deposit palettes: coverage', () => {
  it.each(PALETTE_PROFILES)('%s: every drawable kind in every dimension has its own entry', (profile) => {
    const ores = PALETTES[profile].ores;
    const missing: string[] = [];
    let counted = 0;
    for (const dimension of getProfile(profile).dimensions) {
      for (const id of drawable(profile, dimension)) {
        counted++;
        if (ores[id] === undefined) missing.push(`${dimension}: ${id}`);
        // Never the fallback: an entry of its own, so the same object as a direct lookup of it.
        expect(depositStyle(profile, id).family).toBe(ores[id]?.family);
      }
    }
    expect(missing).toEqual([]);
    expect(counted).toBeGreaterThan(30);
  });

  it('has the per-dimension kind counts the map draws', () => {
    const count = (profile: ProfileId, dimension: DimensionId) => drawable(profile, dimension).length;
    expect(count('tfc-1.20', 'overworld')).toBe(37);
    expect(count('tfg', 'overworld')).toBe(75);
    expect(count('tfg', 'nether')).toBe(29);
    expect(count('tfg', 'moon')).toBe(27);
    expect(count('tfg', 'mars')).toBe(28);
    expect(count('tfg', 'venus')).toBe(2);
    expect(count('tfg', 'glacio')).toBe(0);
  });

  it('treats a TFG dimension without a vein table as drawing nothing', () => {
    const descriptor = getProfile('tfg');
    for (const dimension of descriptor.dimensions) {
      const listed = descriptor.dimensionDepositOres?.[dimension] !== undefined;
      expect([dimension, listed]).toEqual([dimension, VEIN_SET_BY_DIMENSION[dimension] !== undefined]);
    }
  });

  it.each(PALETTE_PROFILES)('%s: lists exactly the vein data minus the rock dikes', (profile) => {
    const fromData = veinDataIds(profile);
    expect(new Set(fromData).size).toBe(fromData.length);
    expect(Object.keys(PALETTES[profile].ores).sort()).toEqual([...fromData].sort());
  });

  it.each(PALETTE_PROFILES)('%s: only the known undrawn veins are never drawn', (profile) => {
    const drawn = new Set(getProfile(profile).dimensions.flatMap((d) => drawable(profile, d)));
    const undrawn = Object.keys(PALETTES[profile].ores).filter((id) => !drawn.has(id));
    expect(undrawn.sort()).toEqual([...UNDRAWN[profile]].sort());
  });

  it('keeps the data’s own spellings and the hidden veins', () => {
    for (const id of ['beneath_molydbenum', 'surface_salpeter', 'mars_neodynium', 'normal_tarkianite', 'mars_surface_cassiterite']) {
      expect(tfgPalette.ores).toHaveProperty(id);
    }
  });
});

describe('deposit palettes: families and categories', () => {
  /** A material as a family: TFC's grade and its placer gravel's suffix off, sand forms folded. */
  const familyOf = (material: string): string =>
    material
      .replace(/^(poor|normal|rich)_/, '')
      .replace(/_deposit$/, '')
      .replace(/^cassiterite_sand$/, 'cassiterite');

  it.each(PALETTE_PROFILES)('%s: a family is the main yield the ore filter shows first', (profile) => {
    const mix = getProfile(profile).depositMix ?? {};
    const wrong: string[] = [];
    for (const dimension of getProfile(profile).dimensions) {
      for (const id of drawable(profile, dimension)) {
        const top = mix[id]?.[0]?.material;
        // A vein that places no ore (gravel) or replaces soil (kaolin) is its own family.
        const expected = top === undefined ? id : familyOf(top);
        const actual = PALETTES[profile].ores[id]?.family;
        if (actual !== expected) wrong.push(`${id}: ${actual} (main yield ${expected})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('reads the families the brief names', () => {
    const family = (id: string) => depositStyle('tfc-1.20', id).family;
    expect(family('normal_malachite')).toBe('malachite');
    expect(family('surface_malachite')).toBe('malachite');
    expect(family('normal_tetrahedrite')).toBe('tetrahedrite');
    expect(family('surface_native_copper')).toBe('native_copper');
    expect(family('fake_native_gold')).toBe('pyrite');
  });

  it.each(PALETTE_PROFILES)('%s: one category per family', (profile) => {
    const categories = new Map<string, Set<string>>();
    for (const entry of Object.values(PALETTES[profile].ores)) {
      categories.set(entry.family, (categories.get(entry.family) ?? new Set()).add(entry.category));
    }
    const mixed = [...categories].filter(([, set]) => set.size > 1).map(([family]) => family);
    expect(mixed).toEqual([]);
  });

  it('applies the graphite and redstone calls to both profiles', () => {
    expect(depositStyle('tfc-1.20', 'graphite').category).toBe('mineral');
    expect(depositStyle('tfg', 'deep_graphite').category).toBe('mineral');
    expect(depositStyle('tfg', 'deep_redstone').category).toBe('mineral');
    // TFC grinds cinnabar and cryolite into redstone; it has no redstone ore of its own.
    expect(depositStyle('tfc-1.20', 'cinnabar').category).toBe('mineral');
    expect(depositStyle('tfc-1.20', 'cryolite').category).toBe('mineral');
    expect(depositStyle('tfc-1.20', 'bituminous_coal').category).toBe('fuel');
    expect(depositStyle('tfg', 'beneath_coal_anthracite').category).toBe('fuel');
    // Pyrite: a gem in TFC (cut with sandpaper), an iron ore in TFG ("Melts into: Cast Iron").
    expect(depositStyle('tfc-1.20', 'fake_native_gold').category).toBe('gem');
    expect(depositStyle('tfg', 'mars_sulfur').category).toBe('metal');
  });
});

describe('deposit palettes: styles', () => {
  it.each(PALETTE_PROFILES)('%s: every entry is a valid style inside the lightness band', (profile) => {
    const file = PALETTES[profile];
    const problems: string[] = [];
    for (const [id, entry] of [...Object.entries(file.ores), ['_fallback', file._fallback] as const]) {
      if (!/^#[0-9a-f]{6}$/.test(entry.color)) problems.push(`${id}: colour ${entry.color}`);
      const L = views(Number.parseInt(entry.color.slice(1), 16)).normal.L;
      if (L < MIN_L - 1e-9 || L > MAX_L + 1e-9) problems.push(`${id}: OKLab L ${L.toFixed(3)}`);
      if (!(entry.category in CATEGORY_SHAPE)) problems.push(`${id}: category ${entry.category}`);
      if (entry.family === '') problems.push(`${id}: no family`);
    }
    expect(problems).toEqual([]);
  });

  it.each(PALETTE_PROFILES)('%s: shape is always CATEGORY_SHAPE[category]', (profile) => {
    for (const id of Object.keys(PALETTES[profile].ores)) {
      const style = depositStyle(profile, id);
      expect([id, style.shape]).toEqual([id, CATEGORY_SHAPE[style.category]]);
    }
  });

  it.each(PALETTE_PROFILES)('%s: namespaced and bare ids give the same style object', (profile) => {
    for (const id of Object.keys(PALETTES[profile].ores)) {
      const bare = depositStyle(profile, id);
      expect(depositStyle(profile, `tfc:${id}`)).toBe(bare);
      expect(depositStyle(profile, `tfg:${id}`)).toBe(bare);
      expect(depositStyle(profile, `TFG:${id.toUpperCase()}`)).toBe(bare);
      // Cached: the second call for a string is the same object, not a rebuilt one.
      expect(depositStyle(profile, id)).toBe(bare);
    }
  });

  it('matches the colour written in the file', () => {
    expect(depositStyle('tfc-1.20', 'tfc:surface_native_copper').color).toBe(
      Number.parseInt(tfcPalette.ores.surface_native_copper.color.slice(1), 16),
    );
    expect(depositStyle('tfg', 'tfc:kaolin').color).toBe(
      Number.parseInt(tfgPalette.ores.kaolin.color.slice(1), 16),
    );
  });

  it('gives unknown ids and palette-less profiles the neutral fallback without throwing', () => {
    const fallback = (file: PaletteFile): Omit<DepositStyle, 'shape'> => ({
      color: Number.parseInt(file._fallback.color.slice(1), 16),
      category: file._fallback.category as DepositCategory,
      family: file._fallback.family,
    });
    expect(depositStyle('tfg', 'tfg:not_a_vein')).toMatchObject(fallback(tfgPalette));
    expect(depositStyle('tfc-1.20', '')).toMatchObject(fallback(tfcPalette));
    expect(depositStyle('tfc-1.18', 'tfc:normal_hematite')).toMatchObject(fallback(tfcPalette));
    expect(depositStyle('vanilla', 'minecraft:iron_ore')).toMatchObject(fallback(tfcPalette));
    expect(depositStyle('tfg', 'tfg:not_a_vein').shape).toBe(
      CATEGORY_SHAPE[depositStyle('tfg', 'tfg:not_a_vein').category],
    );
  });
});

describe('deposit palettes: one colour per family across TerraFirmaGreg dimensions', () => {
  it('keeps every kind within the family floor of its family in every other dimension', () => {
    // The floor between two families within one dimension, 0.08: a family never drifts further
    // across dimensions than two different families may sit within one, so gold on the Moon still
    // reads as the overworld's gold.
    const byFamily = new Map<string, Map<DimensionId, { id: string; lab: Oklab }[]>>();
    for (const dimension of getProfile('tfg').dimensions) {
      for (const id of drawable('tfg', dimension)) {
        const style = depositStyle('tfg', id);
        const dims = byFamily.get(style.family) ?? new Map<DimensionId, { id: string; lab: Oklab }[]>();
        dims.set(dimension, [...(dims.get(dimension) ?? []), { id, lab: views(style.color).normal }]);
        byFamily.set(style.family, dims);
      }
    }
    const far: string[] = [];
    let shared = 0;
    for (const [family, dims] of byFamily) {
      if (dims.size < 2) continue;
      shared++;
      for (const [from, kinds] of dims) {
        for (const [to, others] of dims) {
          if (from === to) continue;
          for (const kind of kinds) {
            const nearest = Math.min(...others.map((other) => oklabDistance(kind.lab, other.lab)));
            if (nearest > FLOOR.family) far.push(`${family}: ${kind.id} is ${nearest.toFixed(3)} from ${to}`);
          }
        }
      }
    }
    expect(far).toEqual([]);
    expect(shared).toBeGreaterThan(30);
  });
});

describe('deposit palettes: kinds that share a shape can be told apart', () => {
  it('measures every drawable group', () => {
    expect(GROUPS.map((group) => group.key).sort()).toContain('tfg/overworld/metal');
    expect(GROUPS.reduce((sum, group) => sum + group.ids.length, 0)).toBe(37 + 75 + 29 + 27 + 28 + 2);
  });

  for (const measure of ['normal', 'protan', 'deutan', 'variant'] as const) {
    const label =
      measure === 'variant' ? 'variants of one family' : `different families (${measure})`;
    it(`${label}: no pair under the floor`, () => {
      const failures = GROUPS.flatMap((group) => closest(group, measure, limit(measure, FLOOR)));
      expect(failures).toEqual([]);
    });

    it(`${label}: every group reaches the target, or its recorded best`, () => {
      const failures = GROUPS.flatMap((group) => {
        const recorded = TARGET_SHORTFALLS[group.key]?.[measure];
        const bound = recorded ?? limit(measure, TARGET);
        return closest(group, measure, bound);
      });
      expect(failures).toEqual([]);
    });
  }

  it('records shortfalls only where a group really falls short', () => {
    // A recorded best that the group now beats should be removed, so the record stays honest.
    const stale = Object.entries(TARGET_SHORTFALLS).flatMap(([key, measures]) => {
      const group = GROUPS.find((candidate) => candidate.key === key);
      if (group === undefined) return [`${key}: no such group`];
      return Object.keys(measures)
        .filter((measure): measure is Measure => measure in TARGET_SHORTFALLS[key]!)
        .filter((measure) => minimum(group, measure) >= limit(measure, TARGET))
        .map((measure) => `${key} ${measure} now meets the target`);
    });
    expect(stale).toEqual([]);
  });
});
