/**
 * What a vein actually yields, from its block-replacement table.
 *
 * This exists because a vein's *name* is often not the ore you are looking for. On TerraFirmaGreg
 * there is no silver vein at all — silver comes out of **galena** (`deep_galena`, `normal_galena`),
 * and a player searching the marker list for "silver" would conclude the map was missing it. The
 * same is true of several GregTech veins, which carry three or four materials each.
 *
 * Pure data derived from the extracted table: no guessing, no lookup list to maintain. If TFG
 * changes what a vein drops, re-extraction changes this automatically.
 */

/** One entry of a vein's `blocks` map. */
export interface RawBlockEntry {
  readonly block: string;
  /** Relative weight within its host rock's list; absent in TFC's own tables, where all are equal. */
  readonly weight?: number;
}

/** `blocks` as extracted: host rock id -> the blocks that replace it. */
export type RawBlockTable = Readonly<Record<string, readonly RawBlockEntry[]>>;

/**
 * The distinct materials a vein places, as bare ids (`silver`, `diamond`, `native_gold`).
 *
 * The two id shapes in play:
 * - TFC: `tfc:ore/<material>/<rock>` — the material is the middle segment.
 * - TFG/GregTech: `gtceu:<rock>_<material>_ore` and `gtceu:raw_<material>_block` — the material is
 *   what remains after stripping the host rock's own name and the `raw_`/`_ore`/`_block` affixes.
 *
 * Anything that matches neither keeps its last path segment rather than being dropped, so a new
 * naming scheme degrades to a slightly ugly name instead of a silently missing ore.
 */
/**
 * The bare rock name from a block-table key. Keys come in two shapes and both appear in the same
 * TFG table: `tfc:rock/raw/andesite` (last path segment) and `minecraft:tuff` (no path at all, so
 * the namespace has to come off or the name stays `minecraft:tuff` and never matches anything).
 */
function rockNameFromKey(key: string): string {
  const last = key.split('/').at(-1) ?? '';
  return last.includes(':') ? last.slice(last.indexOf(':') + 1) : last;
}

/**
 * Collects every host rock name mentioned anywhere in a profile's vein table.
 *
 * Needed because a GregTech block is often prefixed with a rock that the vein holding it does not
 * host in — `gtceu:tuff_coal_ore` can sit under a table with no tuff key at all. Stripping only the
 * vein's own rocks then leaves "Tuff Coal" and "Coal" as two different materials, when they are one
 * material in two rocks, and the filter label becomes unreadable.
 */
/**
 * The rocks a vein's replacement table can host in, as bare ids (`granite`, `slate`).
 *
 * `VeinFeature#place` only writes a block where the table has an entry for the rock already there,
 * so a vein whose table has no entry for any rock in a column places **nothing** in that column —
 * which is why `columnCanHost` below exists.
 */
export function hostRockIdsOf(blocks: RawBlockTable | undefined): ReadonlySet<string> {
  if (!blocks) return new Set();
  return new Set(Object.keys(blocks).map(rockNameFromKey).filter((name) => name !== ''));
}

/**
 * How far above our surface estimate a vein's band must start before it counts as thin air. The
 * surface height is an approximation (2.9 blocks mean error, docs/PARITY.md); the margin keeps a
 * vein that merely grazes the ground, and costs nothing against bands 20 to 80 blocks up.
 */
export const SURFACE_MARGIN = 8;

/**
 * Whether a vein's whole band sits above the ground, where it can place nothing at all.
 *
 * `VeinFeature#place` only replaces raw rock, and air is not raw rock — so a vein with an absolute
 * Y band writes nothing wherever the terrain does not reach that high. Some TerraFirmaGreg veins are
 * written that way on purpose: `high_coal` spans y 90..160 and `high_gypsum` y 90..140, bands that
 * only exist inside a mountain. Measured against Pau's world, that is not a rare edge:
 *
 * | vein | markers | entirely above ground | precision before |
 * | --- | --- | --- | --- |
 * | `high_coal` | 148 | 103 (70%) | 24.6% |
 * | `high_gypsum` | 56 | 28 (50%) | 35.8% |
 *
 * No other vein type is above ground in more than 4% of its markers. Tested on 289 markers of seven
 * vein types, this rule drops 52 markers of which 3 held ore — the centre column decides, because
 * the marker is the spot the player walks to, and a body whose lower lobe clips a hillside 30 blocks
 * away is not something anyone can find.
 */
export function bandIsAboveGround(bottomY: number, surface: number | null | undefined): boolean {
  return surface !== null && surface !== undefined && bottomY > surface + SURFACE_MARGIN;
}

/**
 * Whether a vein rooted at `(x, z)` can place anything at all, given the rock **in its own Y band**.

 * Asking the column as a whole was not enough: at 1658,3735 in Pau's world the column holds slate and
 * gneiss — both of which `normal_gold` can replace — but only far below the vein, whose band sits
 * entirely in conglomerate. The save confirms it: every ore block in that band is `conglomerate_*`.
 *
 * Measured on TerraFirmaGreg: **16% of the markers in a region sat in a column whose rock stack has
 * no entry in the vein's table** — whole vein types (surface gold, surface hematite, native copper,
 * saltpetre) were 100% dead in a rock province that cannot host them, and the map drew every one of
 * them. Pau found this by digging to two of them and coming back with nothing.
 *
 * **One sample, at the middle of the band, in the marker's own column.** This started out
 * generous — five columns a vein-width apart, three levels each, any one match keeping the vein —
 * and generosity turned out to be the single biggest source of wrong markers on the map. Two
 * `deep_galena` markers Pau walked to are the illustration: one sat in chalk over marble over
 * gneiss, none of which galena can replace, and survived because the band's *bottom* sample clipped
 * granite; the other survived on one sample out of fifteen, in a column 24 blocks away.
 *
 * Measured over 5 728 markers of Pau's world, against the ore actually in the save:
 *
 * | rule | markers kept | precision | real markers lost |
 * | --- | --- | --- | --- |
 * | any of 5 columns, any level (was) | 5 728 | 84.3% | 0 |
 * | centre column, any level | 5 415 | 86.5% | 143 |
 * | all 5 columns, any level | 5 111 | 87.3% | 367 |
 * | **centre column, mid level** | **4 876** | **90.4%** | **419** |
 * | centre column, all 3 levels | 3 919 | 90.7% | 1 275 |
 *
 * The mid-level rule is where the curve bends: everything stricter costs three real markers for
 * every point of precision. A profile that cannot answer for its rocks (`rockAt` absent, or `null`
 * at that position) still keeps every vein.
 *
 * The ceiling here is the rock model, not the rule: `rockLayerAtY` is 91.3% accurate against the
 * save (docs/PARITY.md), and a gate cannot be more right than the rock it asks about.
 *
 * An approximation of a per-block check, and declared as one in docs/PARITY.md: the real feature
 * asks at every position it fills, where this asks once, where the body's mass is.
 */
export function columnCanHost(
  hostRockIds: ReadonlySet<string>,
  x: number,
  z: number,
  bottomY: number,
  topY: number,
  rockAt?: (x: number, y: number, z: number) => string | null,
): boolean {
  if (rockAt === undefined || hostRockIds.size === 0) return true;
  const rock = rockAt(x, Math.round((bottomY + topY) / 2), z);
  return rock === null || hostRockIds.has(rock);
}

export function collectRockNames(tables: Iterable<RawBlockTable | undefined>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const table of tables) {
    if (!table) continue;
    for (const key of Object.keys(table)) {
      const name = rockNameFromKey(key);
      if (name !== '') names.add(name);
    }
  }
  return names;
}

/**
 * The material one block entry places, or `''` for a block that is not an ore (plain rock). The two
 * id shapes are documented on `veinMaterials`.
 */
function materialOf(blockId: string, rock: string, rockNames: ReadonlySet<string>): string {
  if (blockId === '') return '';
  const path = blockId.includes(':') ? blockId.slice(blockId.indexOf(':') + 1) : blockId;

  // TFC: ore/<material>/<rock>
  if (path.startsWith('ore/')) return path.split('/')[1] ?? '';
  // TFC gravel and the dike veins place plain rock, which is not an ore worth listing.
  if (path.startsWith('rock/')) return '';

  let name = path.split('/').at(-1) ?? path;
  name = name.replace(/^raw_/, '').replace(/_(ore|block)$/, '');
  if (rock !== '' && name.startsWith(`${rock}_`)) name = name.slice(rock.length + 1);
  // Then any *other* rock this vein hosts in, for the cross-prefixed GregTech blocks above.
  for (const other of rockNames) {
    if (name.startsWith(`${other}_`) && name.length > other.length + 1) {
      name = name.slice(other.length + 1);
      break;
    }
  }
  return name;
}

function rockNamesOf(blocks: RawBlockTable, known?: ReadonlySet<string>): ReadonlySet<string> {
  return known ?? new Set(Object.keys(blocks).map(rockNameFromKey).filter((name) => name !== ''));
}

export function veinMaterials(
  blocks: RawBlockTable | undefined,
  knownRocks?: ReadonlySet<string>,
): readonly string[] {
  if (!blocks) return [];
  const rockNames = rockNamesOf(blocks, knownRocks);
  const out = new Set<string>();
  for (const [rockKey, entries] of Object.entries(blocks)) {
    const rock = rockNameFromKey(rockKey);
    for (const entry of entries) {
      const name = materialOf(entry.block ?? '', rock, rockNames);
      if (name !== '') out.add(name);
    }
  }
  return [...out].sort();
}

/** One material's share of the blocks a vein places, in 0..1. */
export interface VeinMaterialShare {
  readonly material: string;
  readonly share: number;
}

/**
 * How a vein's placed blocks split between materials, biggest first.
 *
 * TFC picks one entry per block by weight within the host rock's list, so a material's share is its
 * weight over that list's total. Shares are averaged over the host rocks, which costs nothing to be
 * right about: across all 76 TerraFirmaGreg veins the per-rock spread is 0.0 points — a vein places
 * the same mixture whatever rock it sits in.
 *
 * Plain rock entries are left out of the total as well as the list, so the shares describe the ore
 * you actually get.
 */
export function veinMaterialMix(
  blocks: RawBlockTable | undefined,
  knownRocks?: ReadonlySet<string>,
): readonly VeinMaterialShare[] {
  if (!blocks) return [];
  const rockNames = rockNamesOf(blocks, knownRocks);
  const sums = new Map<string, number>();
  let rocks = 0;
  for (const [rockKey, entries] of Object.entries(blocks)) {
    const rock = rockNameFromKey(rockKey);
    const named = entries
      .map((entry) => ({
        material: materialOf(entry.block ?? '', rock, rockNames),
        weight: entry.weight ?? 1,
      }))
      .filter((entry) => entry.material !== '');
    const total = named.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) continue;
    rocks++;
    for (const { material, weight } of named) {
      sums.set(material, (sums.get(material) ?? 0) + weight / total);
    }
  }
  if (rocks === 0) return [];
  return [...sums]
    .map(([material, sum]) => ({ material, share: sum / rocks }))
    .sort((a, b) => b.share - a.share || a.material.localeCompare(b.material));
}

// Moved to `@worldgen/api/types` so `app/`'s ore search can use it without importing a profile.
// Re-exported here because both vein ports already import it from this module.
export { veinFilterId } from '@worldgen/api/types';
