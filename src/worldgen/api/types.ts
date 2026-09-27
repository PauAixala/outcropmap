/**
 * The contract every version profile implements. Rendering and UI code depends on this file and
 * nothing deeper. Keep it free of DOM, canvas and version-specific concepts.
 */

/**
 * Every profile here is a real port. The Phase 1 'debug' scaffolding profile (cheap fake noise, used
 * to exercise the shell and tile pipeline before any Java was ported) was removed on 2026-09-10 —
 * shipping a profile whose output means nothing is exactly the confidently-wrong output CLAUDE.md
 * section 2 exists to prevent. Note that the `region-debug` *layer* is unrelated: it is a developer
 * overlay drawing real region ownership boundaries from a real generator.
 */
export type ProfileId = 'tfc-1.20' | 'tfg' | 'tfc-1.18' | 'vanilla';

export const PROFILE_IDS: readonly ProfileId[] = ['tfc-1.20', 'tfg', 'tfc-1.18', 'vanilla'];

/** The four planets are Ad Astra's, which TerraFirmaGreg ships and rebuilds; they are dimensions
 *  in exactly the sense the Nether is, so they belong on this axis rather than beside it. */
export type DimensionId =
  | 'overworld'
  | 'nether'
  | 'end'
  | 'moon'
  | 'mars'
  | 'venus'
  | 'glacio';

export const DIMENSION_IDS: readonly DimensionId[] = [
  'overworld',
  'nether',
  'end',
  'moon',
  'mars',
  'venus',
  'glacio',
];

export type GeneratorSettings = Readonly<Record<string, number>>;

export interface NumericSettingDescriptor {
  readonly id: string;
  readonly labelKey: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
  readonly integer?: boolean;
}

export interface ProfileDescriptor {
  readonly id: ProfileId;
  readonly label: string;
  readonly mcVersion: string;
  readonly dimensions: readonly DimensionId[];
  /** Layers this profile can actually produce. Anything absent is hidden in the UI, not broken. */
  readonly layers: readonly LayerId[];
  readonly settings?: readonly NumericSettingDescriptor[];
  /** Available deposit IDs and explanatory text for this profile. */
  readonly depositOres?: readonly string[];
  /**
   * The same ids split per dimension, for the ore filter.
   *
   * `depositOres` is the union across every dimension, which is what the *labels* and the yield
   * tables need — but a filter listing Mars's ores while the player is looking at the overworld is
   * a control that can only ever match nothing. A dimension absent here falls back to the union.
   */
  readonly dimensionDepositOres?: Partial<Record<DimensionId, readonly string[]>>;
  /**
   * What each vein actually places, keyed by the same id as `depositOres`.
   *
   * A vein's name is often not the material you want — TFG has no silver vein at all; silver comes
   * out of galena, lead and bismuth. Without this the filter is a list of names that cannot answer
   * "where is the silver", which is the question people actually have.
   */
  readonly depositYields?: Readonly<Record<string, readonly string[]>>;
  /**
   * The heights each filter id can generate at, keyed like `depositOres`. Several veins can share a
   * filter id, so the range is their union. `project` marks a vein whose range is measured from the
   * surface rather than from world zero (`VeinConfig#projectToSurface`), which reads as a different
   * number entirely and must not be shown as an absolute Y.
   */
  readonly depositYRanges?: Readonly<
    Record<string, { readonly minY: number; readonly maxY: number; readonly project: boolean }>
  >;
  /**
   * How each vein's blocks split between materials, biggest share first, keyed like `depositOres`.
   * With `typicalBlocks` this turns "57% gold" into "about 1 350 gold blocks", which is the form a
   * player can act on.
   */
  readonly depositMix?: Readonly<
    Record<string, readonly { readonly material: string; readonly share: number }[]>
  >;
  /**
   * How often each vein type's markers were backed by real ore in a generated world
   * (`tools/verify-veins.py`). Measured, not assumed: the map can only tell you a vein *should* be
   * there, and a modpack can define a vein its own worldgen never places — `normal_tarkianite` is
   * defined, registered and absent from 5 400 sampled chunks of Pau's world.
   */
  readonly depositReliability?: Readonly<
    Record<string, { readonly checked: number; readonly real: number; readonly precision: number }>
  >;
  /**
   * The same measurement bucketed by how deep a marker is, keyed by the bucket's lower edge in
   * blocks below the surface (`-16` meaning above it). See `markerConfidence`.
   */
  readonly depositDepthReliability?: Readonly<
    Record<string, { readonly checked: number; readonly real: number; readonly precision: number }>
  >;
  /**
   * A typical ore-block count for one vein type, or `null` where the shape has no port for it
   * (pipe veins) — never a guess. A function rather than a table because it walks the vein's whole
   * bounding box: ~150 ms for a profile's veins, cached inside, so the caller chooses when to pay.
   */
  readonly typicalBlocks?: (filterId: string) => number | null;
  /** Map colours keyed by biome registry id, shared by raster rendering and legend. */
  readonly biomePalette?: Readonly<Record<string, number>>;
  /**
   * Which biomes each dimension can show, for the legend and the biome filter.
   *
   * Ids only, no colours: the overworld's palette is a designed one, and the other dimensions'
   * 108 biomes have none — the map already paints an unpalettedbiome in a stable colour derived
   * from its id, and the legend uses the same expression so the two agree by construction rather
   * than by a second table someone has to keep in step.
   *
   * A dimension absent here falls back to `biomePalette`'s keys, which is the overworld.
   */
  readonly dimensionBiomeIds?: Partial<Record<DimensionId, readonly string[]>>;
  /** Map colours keyed by rock registry id, shared by raster rendering and legend. Unlike
   * biomePalette these are a UI design choice (geologically-themed), not extracted game data —
   * see src/data/palettes/tfc-1.20-rocks.json's own header. */
  readonly rockPalette?: Readonly<Record<string, number>>;
}

export type LayerId =
  | 'biome'
  | 'rock'
  | 'temperature'
  | 'rainfall'
  | 'terrain'
  | 'hillshade'
  | 'contours'
  | 'ores'
  | 'minerals'
  | 'structures'
  | 'region-debug'
  | 'filter'
  | 'grid';

export const LAYER_IDS: readonly LayerId[] = [
  'biome',
  'rock',
  'temperature',
  'rainfall',
  'terrain',
  'hillshade',
  'contours',
  'ores',
  'minerals',
  'structures',
  'region-debug',
  'filter',
  'grid',
];

/** Generator ownership region, with its actual centre in block coordinates. */
export interface RegionDebugSample {
  readonly id: string;
  readonly centerX: number;
  readonly centerZ: number;
}

export interface ClimateSample {
  /** Average annual temperature, in the units the mod uses (document them in the port). */
  readonly temperature: number;
  /** Annual rainfall. */
  readonly rainfall: number;
}

/**
 * Region-grid landform data: `net.dries007.tfc.world.region.Region.Point`'s flags plus
 * `distanceToOcean`/`distanceToEdge`/`baseLandHeight`/`biomeAltitude`. Read directly off the single
 * grid point (128 blocks) the probed position falls in — Java never interpolates these between
 * neighbouring points either, unlike `temperature`/`rainfall` (see `RegionChunkDataGenerator`'s
 * `LerpFloatLayer` use, which is climate-only).
 */
export interface TerrainSample {
  /** `Point.land()`. `false` means this grid point is ocean. */
  readonly land: boolean;
  /** `Point.island()`: a small landmass placed by `AddIslands` inside an ocean. */
  readonly island: boolean;
  /** `Point.mountain()`, set by `AddMountains`. */
  readonly mountain: boolean;
  /** `Point.coastalMountain()`: a mountain range `AddMountains` placed near the shore. */
  readonly coastalMountain: boolean;
  /** `Point.distanceToOcean`, in grid units (1 grid = 128 blocks — `Units.GRID_WIDTH_IN_BLOCK`).
   * Negative on the ocean side of the coastline; `-2` marks a shore ocean cell. */
  readonly distanceToOcean: number;
  /** `Point.distanceToEdge`: distance to the nearest edge of this region's owned footprint, same
   * grid units as `distanceToOcean`. `-1` marks the edge itself. */
  readonly distanceToEdge: number;
  /** `Point.baseLandHeight`: a dimensionless inland-ness index (`AnnotateBaseLandHeight`) used to
   * place mountain ranges — not a block height. */
  readonly baseLandHeight: number;
  /** `Point.biomeAltitude`: a dimensionless altitude-tier index (`AnnotateBiomeAltitude`) used to
   * pick which altitude band of biomes applies — not a block height. */
  readonly biomeAltitude: number;
}

export interface RockStack {
  readonly bottom: string;
  readonly middle: string;
  readonly top: string;
  /** The rock returned by the profile's surface-rock sampler. */
  readonly surface: string | null;
}

/** Everything the hover readout shows for one block column. */
export interface Probe {
  readonly x: number;
  readonly z: number;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly regionX: number;
  readonly regionZ: number;
  readonly regionDebug?: RegionDebugSample;
  readonly biome: string | null;
  /** `null` only when a fast, main-thread-only probe (`WorldGenerator.probeFast`) skipped it to
   * avoid building a not-yet-cached region — never a value the generator failed to compute. The
   * plain `probe()` path always fills this in. */
  readonly climate: ClimateSample | null;
  readonly rocks: RockStack | null;
  /** Land/ocean and mountain flags plus the region-grid distance/height fields — see
   * `TerrainSample`. Same fast-probe caveat as `climate`. */
  readonly terrain: TerrainSample | null;
  /** Approximate — see docs/PARITY.md for the declared error bound. */
  readonly surfaceY: number | null;
}

/**
 * Whether a deposit can be reached without digging. This drives a headline filter, so it must be
 * honest: when it cannot be determined (cave exposure before the carvers are ported), return
 * 'unknown' rather than guessing.
 */
export type ExposureClass = 'surface' | 'cave' | 'buried' | 'unknown';

/**
 * The id a deposit reports for filtering: its `ore` with the namespace stripped.
 *
 * Deliberately **not** the vein's key in the table. They differ — `kaolin_disc` reports `kaolin`,
 * `diorite_dike` reports `diorite` — and offering the table key while deposits report the random
 * name is what once made the ore filter match nothing. Every side keys off this one function.
 *
 * It lives in the profile-agnostic api rather than under `tfc-1.20/` because both profiles and the
 * ore search in `@app` need it, and `app/` must not reach into a profile (CLAUDE.md section 3).
 */
/**
 * A vein type is hidden when a real world says its markers are almost never real.
 *
 * The threshold is deliberately low and the sample requirement high: this hides `normal_tarkianite`
 * (4 of 154) and nothing that merely has a bad day. A hidden type still appears in the filter, greyed
 * and labelled, because silently dropping an ore reads as a missing feature.
 */
export const UNRELIABLE_PRECISION = 0.2;
export const RELIABILITY_MIN_SAMPLE = 30;

/**
 * How likely one marker is to be backed by real ore, from 0 to 1 — not the vein type's average, this
 * marker's.
 *
 * **Depth is the signal.** Measured over 4 733 markers of Pau's world, how far the middle of the
 * band sits below our surface height predicts a hit far better than anything else we tried (rock
 * sample agreement across a neighbourhood: 90.6% against 89.7%, useless; a dike nearby: 90.6%
 * against 87.0%, nearly useless):
 *
 * | middle of the band | markers | backed by real ore |
 * | --- | --- | --- |
 * | above the surface | 108 | 27.8% |
 * | 0–15 blocks down | 2 068 | 85.5% |
 * | 16–31 | 625 | 91.4% |
 * | 32–47 | 231 | 94.4% |
 * | 48–63 | 194 | 97.9% |
 * | 64 and deeper | 1 507 | **99.8%** |
 *
 * The reason is not mysterious: near the surface a vein meets soil, caves, water and the slope
 * itself, and our surface height carries about a block and a half of error. Deep in the rock there is
 * nothing to get wrong.
 *
 * The vein type's own measured precision caps the result, since a type that rarely delivers does not
 * become trustworthy by being deep. Taking the smaller of the two rather than multiplying them: the
 * two signals overlap heavily (the `surface_*` veins are exactly the shallow ones), and multiplying
 * would punish them twice for one fact.
 */
export function markerConfidence(
  reliability: ProfileDescriptor['depositReliability'],
  depthTable: ProfileDescriptor['depositDepthReliability'],
  filterId: string,
  depthBelowSurface: number | null,
): number | null {
  let byDepth: number | null = null;
  if (depthTable && depthBelowSurface !== null) {
    let best = -Infinity;
    for (const [edge, entry] of Object.entries(depthTable)) {
      const lower = Number(edge);
      if (depthBelowSurface >= lower && lower > best && entry.checked >= RELIABILITY_MIN_SAMPLE) {
        best = lower;
        byDepth = entry.precision;
      }
    }
  }
  const vein = reliability?.[filterId];
  const byVein =
    vein && vein.checked >= RELIABILITY_MIN_SAMPLE ? vein.precision : null;
  if (byDepth === null) return byVein;
  return byVein === null ? byDepth : Math.min(byDepth, byVein);
}

export function veinIsUnreliable(
  reliability: ProfileDescriptor['depositReliability'],
  filterId: string,
): boolean {
  const entry = reliability?.[filterId];
  if (!entry || entry.checked < RELIABILITY_MIN_SAMPLE) return false;
  return entry.precision < UNRELIABLE_PRECISION;
}

export function veinFilterId(ore: string): string {
  return ore.replace(/^[^:]+:/, '');
}

export type VeinShape = 'cluster' | 'pipe' | 'disc';

/** The subset of TFC's `Indicator` the map uses. Extracted data, exact. */
export interface VeinIndicator {
  /** 0 means the vein has no above-ground indicator at all, only underground ones. */
  readonly rarity: number;
  /** How far the surface may sit above the topmost placed ore block for one to spawn. */
  readonly depth: number;
}

export type IndicatorReach = 'possible' | 'too-deep' | 'none' | 'unknown';

export interface DepositFeature {
  readonly id: string;
  readonly kind: 'ore' | 'mineral';
  /** Registry name of the ore/mineral, e.g. 'tfc:normal_hematite'. */
  readonly ore: string;
  readonly shape: VeinShape;
  readonly x: number;
  readonly z: number;
  readonly topY: number;
  readonly bottomY: number;
  /** `null` when surface height is not ported for this profile yet (docs/PARITY.md) — never a
   * guessed value. Same honesty rule as `Probe.surfaceY`/`WorldGenerator.surfaceY`. */
  readonly surfaceY: number | null;
  /** surfaceY - topY. Negative means the vein pokes above the surface. `null` exactly when
   * `surfaceY` is `null` — never computed from a guessed surface height. */
  readonly depthBelowSurface: number | null;
  readonly exposure: ExposureClass;
  /** The rock types this vein's block-replacement table can host (e.g. 'granite, shale, ...'),
   * NOT the one specific rock actually present at this instance — that would require the same
   * surface-height-dependent generation `surfaceY` above does not have (a vein's real host rock
   * depends on which rock layer is present at its real world Y, which needs real surface height
   * to resolve — see `RockStack`'s doc comment). Empty string for a vein that bypasses rock
   * replacement entirely (e.g. kaolin, which replaces grass/soil, not a rock list). Always a
   * factual (extracted-data) list, never a guess about which member applies here. */
  readonly hostRock: string;
  /** Whether TFC spawns a surface indicator for this vein — visible on the ground in game. */
  readonly hasIndicator: boolean;
  /** `Indicator.rarity` and `Indicator.depth` as extracted, or `null` when the vein defines none. */
  readonly indicator: VeinIndicator | null;
  /**
   * Whether an above-ground indicator — the small ore chunks that let a player find a vein by
   * walking — can spawn over this deposit. `'too-deep'` is a certainty derived from the surface
   * height; `'possible'` still depends on the rarity roll and on ore actually generating here, so
   * it is never a promise. `'unknown'` when the profile has no surface height.
   */
  readonly indicatorReach: IndicatorReach;
  /** "1 in `rarity` chunks", `VeinConfig.rarity` — lower is more common. */
  readonly rarity: number;
  /**
   * `VeinConfig.size` — the vein's radius in blocks on every axis, so it spans up to `2*size+1`.
   * Extracted data, exact. Absent for a vein whose port does not report it.
   */
  readonly size?: number;
  /**
   * `VeinConfig.density` — the probability that a position inside the vein's shape becomes ore,
   * *before* the game's own check that the block there is a replaceable raw rock. Extracted data,
   * exact; it is not a block count. See `typicalVeinBlocks` for what can be said about counts.
   */
  readonly density?: number;
  /**
   * A **typical** ore-block count for this vein type: positions inside a representative vein shape
   * times `density`. An upper bound and a rough one — the game also skips any position not already
   * holding a replaceable raw rock, which needs terrain we have not ported, and the shape is
   * re-rolled per vein. Never present it as the amount of ore actually in the ground.
   */
  readonly typicalOreBlocks?: number;
  /**
   * Footprint of a disc vein in blocks — how many columns the patch covers, and its widest span.
   * For kaolin this is the figure that matters and the only one reported: the clay only forms where
   * the patch meets surface soil, so its *volume* says nothing useful until surface height lands.
   */
  readonly footprintBlocks?: number;
  readonly blocksAcross?: number;
  /** Full vertical extent of a disc, `2 * height + 1`. Exact, from extracted data. */
  readonly blocksTall?: number;
  /**
   * The materials this vein actually places, as bare ids, from its block-replacement table.
   *
   * A vein's *name* is often not the ore you want: on TerraFirmaGreg there is no silver vein, and
   * silver comes out of **galena**. Without this a player searching for silver would conclude the
   * map was missing it. Extracted data, exact — not a curated list.
   */
  readonly produces?: readonly string[];
}

export interface StructureFeature {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly z: number;
  readonly y?: number;
}

/** The two kinds of vector feature a caller can ask for separately. */
export type FeatureKind = 'deposits' | 'structures';

export interface FeatureSet {
  readonly deposits: readonly DepositFeature[];
  readonly structures: readonly StructureFeature[];
}

export interface BlockBox {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
}

export interface WorldGenerator {
  readonly profile: ProfileDescriptor;
  readonly seed: bigint;
  readonly dimension: DimensionId;

  climate(x: number, z: number): ClimateSample;
  rocks(x: number, z: number): RockStack | null;
  biome(x: number, z: number): string | null;
  /** Optional developer view of actual region ownership; never a regular-grid approximation. */
  regionDebug?(x: number, z: number): RegionDebugSample;
  /** Approximate surface height. See docs/PARITY.md. */
  surfaceY(x: number, z: number): number | null;
  probe(x: number, z: number): Probe;
  /**
   * Best-effort synchronous probe for the hover readout: never triggers expensive generation work
   * (building a not-yet-cached region). Fields that would require that come back `null` on the
   * returned `Probe` rather than blocking — the caller (see `mountHoverReadout`) shows those fields
   * as unavailable and falls back to `probe()` (routed through the worker pool) to fill them in.
   * Profiles with no expensive path may omit this; callers fall back to plain `probe()`, which is
   * already cheap for them.
   */
  probeFast?(x: number, z: number): Probe;
  /**
   * Vector features for an area. Exposure is computed here, once, and cached by the caller.
   * `kinds` limits the work to what is shown: deposits cost seconds per region, structures little,
   * and a view with only structures on must not pay for deposits. Omitted means both.
   * `ores` limits deposits the same way, by filter id (`veinFilterId`); omitted or empty means
   * every ore. A map filtered to one ore then generates one ore.
   */
  features(box: BlockBox, kinds?: readonly FeatureKind[], ores?: readonly string[]): FeatureSet;
}

export interface GeneratorOptions {
  readonly seed: bigint;
  readonly dimension: DimensionId;
  readonly settings?: GeneratorSettings;
}

export type GeneratorFactory = (options: GeneratorOptions) => WorldGenerator;
