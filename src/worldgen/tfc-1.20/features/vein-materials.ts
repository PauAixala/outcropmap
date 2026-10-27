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
 *
 * The site's guides name materials the same way (`blockYield` in src/app/site/guide-data.ts, which
 * also folds TFC's grades together); tests/unit/vein-materials.test.ts checks that the two agree.
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
 * The bare id of a block-table key: the stone a vein's blocks replace. Three key shapes appear, the
 * first two side by side in the same TFG table:
 *
 * - `tfc:rock/raw/andesite` (and `rock/gravel/`, `rock/hardened/`): the last path segment;
 * - `minecraft:tuff`, `ad_astra:moon_deepslate`: no path at all, so the namespace has to come off,
 *   or the name stays `minecraft:tuff` and never matches anything;
 * - `tfc:sand/<colour>`: `<colour>_sand`. GregTech names its sand ores after the sand,
 *   `gtceu:black_sand_basaltic_mineral_sand_ore`, so the colour alone is no host. Kept bare, it
 *   left "sand_basaltic_mineral_sand" behind — and as one of the table's rocks it cut the colour
 *   off real materials in other veins: `gtceu:granite_yellow_limonite_ore` read as limonite.
 */
function hostIdOf(key: string): string {
  const path = key.slice(key.indexOf(':') + 1);
  const parts = path.split('/');
  const last = parts.at(-1) ?? path;
  return parts.length === 2 && parts[0] === 'sand' ? `${last}_sand` : last;
}

/**
 * The rocks a vein's replacement table can host in, as bare ids (`granite`, `slate`, `black_sand`).
 *
 * `VeinFeature#place` only writes a block where the table has an entry for the rock already there,
 * so a vein whose table has no entry for any rock in a column places **nothing** in that column —
 * which is why `columnCanHost` below exists.
 */
export function hostRockIdsOf(blocks: RawBlockTable | undefined): ReadonlySet<string> {
  if (!blocks) return new Set();
  return new Set(Object.keys(blocks).map(hostIdOf).filter((name) => name !== ''));
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

/**
 * Collects every host rock name mentioned anywhere in a profile's vein table.
 *
 * Needed because a GregTech block is often prefixed with a rock that the vein holding it does not
 * host in — `gtceu:tuff_coal_ore` can sit under a table with no tuff key at all. Stripping only the
 * vein's own rocks then leaves "Tuff Coal" and "Coal" as two different materials, when they are one
 * material in two rocks, and the filter label becomes unreadable.
 */
export function collectRockNames(tables: Iterable<RawBlockTable | undefined>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const table of tables) {
    if (!table) continue;
    for (const key of Object.keys(table)) {
      const name = hostIdOf(key);
      if (name !== '') names.add(name);
    }
  }
  return names;
}

/**
 * TFC's ore deposits, `tfc:deposit/<mineral>/<rock>`, as a material: `native_copper_deposit`, which
 * `formatMaterialName` (src/ui/i18n/ore-names.ts) reads as "Native Copper Deposit".
 */
const DEPOSIT_SUFFIX = '_deposit';

/** What one block entry places, and whether its id showed where the stone ends. */
interface BlockMaterial {
  readonly material: string;
  /**
   * False for a GregTech name that no stone prefix explained and that is not a raw ore block: the
   * stone it starts with is unknown, so `resolveMaterial` matches it against the table's materials.
   */
  readonly resolved: boolean;
}

/**
 * The material one block entry places, or `null` for a block that is not an ore. The id shapes in
 * play:
 *
 * - TFC ore, `tfc:ore/<material>/<rock>`: the middle segment. The graded metal ores keep their
 *   grade (`poor_native_copper`, `normal_native_copper`, `rich_native_copper`): each grade is its
 *   own block with its own yield, and the filter lists them apart on purpose.
 * - TFC deposit, `tfc:deposit/<mineral>/<rock>`: the pannable placer gravel that
 *   `surface_native_copper` and `surface_cassiterite` place beside their ore, named
 *   `<mineral>_deposit` to keep it apart from the ore. Read like a GregTech block, its last segment
 *   named it after the rock: "Andesite".
 * - TFC plain rock, `tfc:rock/...` (the gravel disc, the dikes): not an ore, so `null`.
 * - GregTech `gtceu:<stone>_<material>_ore` and `gtceu:raw_<material>_block`, and vanilla's
 *   `minecraft:raw_<material>_block`: what remains once the `raw_`/`_ore`/`_block` affixes and the
 *   stone come off. The stone is the host's own name or, failing that, any other rock the table
 *   names (`gtceu:tuff_coal_ore` can sit under a vein with no tuff key), longest first, so
 *   `black_sand_` wins over a shorter rock that happens to prefix it. One stone at most: a second
 *   strip is how "yellow_limonite" once became "limonite".
 *
 * GregTech does not always name an ore after the block it replaces. In the Beneath, blackstone and
 * magma hold `gtceu:pyroxenite_<material>_ore` and dripstone `gtceu:dripstone_<material>_ore` (the
 * host key is `minecraft:dripstone_block`), and Venus's dripstone does the same; neither pyroxenite
 * nor dripstone is a rock of the table. Such a name comes back unresolved, for `resolveMaterial`.
 *
 * Anything else keeps its last path segment rather than being dropped, so a new naming scheme
 * degrades to a slightly ugly name instead of a silently missing ore.
 */
function blockMaterial(
  blockId: string,
  host: string,
  rocks: readonly string[],
): BlockMaterial | null {
  if (blockId === '') return null;
  const path = blockId.slice(blockId.indexOf(':') + 1);

  if (path.startsWith('ore/') || path.startsWith('deposit/')) {
    const [kind, middle = ''] = path.split('/');
    if (middle === '') return null;
    return { material: kind === 'deposit' ? `${middle}${DEPOSIT_SUFFIX}` : middle, resolved: true };
  }
  if (path.startsWith('rock/')) return null;

  const last = path.slice(path.lastIndexOf('/') + 1);
  // A raw ore block names its material and nothing else: `raw_alunite_block`.
  const raw = last.startsWith('raw_');
  let name = last.replace(/^raw_/, '').replace(/_(ore|block)$/, '');
  let resolved = raw;
  if (host !== '' && name.startsWith(`${host}_`)) {
    name = name.slice(host.length + 1);
    resolved = true;
  } else {
    for (const rock of rocks) {
      if (name.startsWith(`${rock}_`) && name.length > rock.length + 1) {
        name = name.slice(rock.length + 1);
        resolved = true;
        break;
      }
    }
  }
  return name === '' ? null : { material: name, resolved };
}

/**
 * The material an unresolved GregTech name ends with, among those its table names plainly
 * (`knownVeinMaterials`), longest first: `pyroxenite_bismuth` -> `bismuth`,
 * `dripstone_rock_salt` -> `rock_salt` rather than `salt`. A name that ends with none of them stays
 * as it is — which shows a shape this does not know rather than hiding it — and so does every name
 * when there is no table.
 */
function resolveMaterial(found: BlockMaterial, known: ReadonlySet<string> | undefined): string {
  if (found.resolved || known === undefined) return found.material;
  let best: string | null = null;
  for (const material of known) {
    if (!found.material.endsWith(`_${material}`)) continue;
    if (best === null || material.length > best.length) best = material;
  }
  return best ?? found.material;
}

/** Rock names longest first, the order `blockMaterial` tries them in. */
function longestFirst(rockNames: ReadonlySet<string>): readonly string[] {
  return [...rockNames].sort((a, b) => b.length - a.length);
}

/**
 * The materials a whole vein table names plainly — raw ore blocks (`raw_<material>_block`), the
 * ores whose stone prefix came off, TFC's own `ore/` and `deposit/` ids — for `resolveMaterial`.
 *
 * Per table rather than per vein: a Beneath vein's pyroxenite ores are matched against everything
 * the dimension calls a material. `veinTableNames` works it out once per table, with that table's
 * `collectRockNames`; callers hand both to `veinMaterials` and `veinMaterialMix`.
 */
export function knownVeinMaterials(
  tables: Iterable<RawBlockTable | undefined>,
  rockNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const rocks = longestFirst(rockNames);
  const known = new Set<string>();
  for (const table of tables) {
    if (!table) continue;
    for (const [key, entries] of Object.entries(table)) {
      const host = hostIdOf(key);
      for (const entry of entries) {
        const found = blockMaterial(entry.block ?? '', host, rocks);
        if (found !== null && found.resolved) known.add(found.material);
      }
    }
  }
  return known;
}

/** A vein table as extracted: vein id -> its config, of which only the block table matters here. */
export type VeinBlockTables = Readonly<
  Record<string, { readonly blocks?: RawBlockTable | undefined }>
>;

/** What naming one table's blocks takes: its rocks (`collectRockNames`), its plain materials. */
export interface VeinTableNames {
  readonly rocks: ReadonlySet<string>;
  readonly materials: ReadonlySet<string>;
}

/** Keyed on the table object itself, which every port and profile shares (`vein-tables.ts`). */
const TABLE_NAMES = new WeakMap<VeinBlockTables, VeinTableNames>();

/**
 * Every rock a vein table names and every material it names plainly, worked out once per table and
 * cached: the three vein ports and both profiles ask, and none of them should walk a table twice.
 */
export function veinTableNames(table: VeinBlockTables): VeinTableNames {
  const cached = TABLE_NAMES.get(table);
  if (cached) return cached;
  const blocks = Object.values(table).map((vein) => vein.blocks);
  const rocks = collectRockNames(blocks);
  const names: VeinTableNames = { rocks, materials: knownVeinMaterials(blocks, rocks) };
  TABLE_NAMES.set(table, names);
  return names;
}

/** The rock names to strip: the table's when given, else this vein's own. */
function rocksFor(blocks: RawBlockTable, knownRocks?: ReadonlySet<string>): readonly string[] {
  return longestFirst(knownRocks ?? collectRockNames([blocks]));
}

/**
 * The distinct materials a vein places, as bare ids (`silver`, `diamond`, `poor_native_copper`,
 * `native_copper_deposit`) — see `blockMaterial` for the id shapes.
 *
 * `knownRocks` is every rock the vein's whole table names (`collectRockNames`), and
 * `knownMaterials` what that table names plainly (`knownVeinMaterials`). Without them a vein is
 * named from its own blocks alone, which leaves cross-prefixed ores (`tuff_coal`) and the Beneath's
 * pyroxenite and dripstone ores unresolved.
 */
export function veinMaterials(
  blocks: RawBlockTable | undefined,
  knownRocks?: ReadonlySet<string>,
  knownMaterials?: ReadonlySet<string>,
): readonly string[] {
  if (!blocks) return [];
  const rocks = rocksFor(blocks, knownRocks);
  const out = new Set<string>();
  for (const [key, entries] of Object.entries(blocks)) {
    const host = hostIdOf(key);
    for (const entry of entries) {
      const found = blockMaterial(entry.block ?? '', host, rocks);
      if (found !== null) out.add(resolveMaterial(found, knownMaterials));
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
 * How a vein's placed blocks split between materials, biggest first. Named as `veinMaterials`
 * names them, with the same optional table-wide rocks and materials.
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
  knownMaterials?: ReadonlySet<string>,
): readonly VeinMaterialShare[] {
  if (!blocks) return [];
  const rocks = rocksFor(blocks, knownRocks);
  const sums = new Map<string, number>();
  let hosts = 0;
  for (const [key, entries] of Object.entries(blocks)) {
    const host = hostIdOf(key);
    const named = entries.flatMap((entry) => {
      const found = blockMaterial(entry.block ?? '', host, rocks);
      return found === null
        ? []
        : [{ material: resolveMaterial(found, knownMaterials), weight: entry.weight ?? 1 }];
    });
    const total = named.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) continue;
    hosts++;
    for (const { material, weight } of named) {
      sums.set(material, (sums.get(material) ?? 0) + weight / total);
    }
  }
  if (hosts === 0) return [];
  return [...sums]
    .map(([material, sum]) => ({ material, share: sum / hosts }))
    .sort((a, b) => b.share - a.share || a.material.localeCompare(b.material));
}

// Moved to `@worldgen/api/types` so `app/`'s ore search can use it without importing a profile.
// Re-exported here because both vein ports already import it from this module.
export { veinFilterId } from '@worldgen/api/types';
