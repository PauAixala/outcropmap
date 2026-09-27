/**
 * TFC 1.20 profile: registers itself with `../registry` (see `../profiles.ts` for why profiles
 * register from a separate module). Climate uses `RegionGenerator` plus
 * `AnnotateClimate`'s bias correction (see `./region/` and `./climate/`), ported from
 * `net.dries007.tfc.world.region.RegionGenerator`/`TFCChunkGenerator`. The biome map samples the
 * quart biome layer (`RegionBiomeSource.getNoiseBiome`, `RegionGenerator.biomeAtQuart`); river
 * carving into the biome layer (`AddRiversAndLakes`) is a later phase, so a river channel itself
 * does not yet show up as `tfc:river` — see `docs/WORLDGEN-NOTES.md`.
 * Rock stacks and the laterally skewed surface-rock sample are real. Surface height includes the
 * biome and shore passes and is explicitly approximate until TFC river carving lands.
 */
import { blockToChunk, blockToQuart } from '@core/coords/coords';
import { registerProfile } from '../registry';
import type { BlockBox, ClimateSample, DimensionId, FeatureSet, GeneratorOptions, Probe, ProfileDescriptor, RegionDebugSample, RockStack, TerrainSample, WorldGenerator, FeatureKind } from '../api/types';
import { sampleClimate } from './climate';
import { biomeId } from './biome';
import { Biome, hasRivers } from './biome/ids';
import { SurfaceHeightSampler } from './biome/surface-height';
import { resolveDepositDepth } from '@worldgen/api/depth';
import biomePalette from '@data/palettes/tfc-1.20-biomes.json';
import rockPalette from '@data/palettes/tfc-1.20-rocks.json';
import { RegionGenerator } from './region/generator';
import {
  blockToGrid,
  GRID_WIDTH_IN_BLOCK,
  quartToGrid,
  quartToGridExact,
} from './region/units';
import { rockStackAtPoint, sampleAtLayer } from './rock/layer-settings';
import {
  clusterDepositsInBox,
  clusterVeinsFor,
  discDepositsInBox,
  discVeinsFor,
  filterDiscDepositsByClimate,
  pipeDepositsInBox,
  pipeVeinsFor,
  DIKE_OVERWRITES,
  dikeRockAt,
  dikesInBox,
  rawVeinBlocks,
  typicalPipeVeinBlocks,
  typicalVeinBlocks,
  veinFilterId,
  veinMaterialMix,
} from './features';
import { discVeinExtent } from './features/disc-vein';

/**
 * World-preset fields exposed as sliders (`ProfileDescriptor.settings`), read from
 * `net.dries007.tfc.world.settings.Settings` and defaulted from
 * `data/tfc/worldgen/world_preset/overworld.json` (see `docs/WORLDGEN-NOTES.md`'s "World preset
 * settings" section for the confirmed effect of each field, cited against
 * `$HOME/reference/tfc`). Upper bounds are this project's own choice for a usable slider range,
 * not from the Java source (`Settings` itself declares no upper bound — TFC's datapack can set any
 * value). `temperatureScale`/`rainfallScale`'s lower bound of 0 is *not* a UI choice, though:
 * `RegionGenerator.baseNoise` (see `./region/generator.ts`'s `baseNoise`) special-cases
 * `scale === 0` to mean "ignore the noise field, use the paired *Constant everywhere instead" — a
 * real, documented mode (`Settings`'s own doc comment), not an edge case to fence off. A slider
 * bounded at `min: 1` (the previous bound here) could never reach it.
 */
/**
 * `depositOres` and `depositYields` for a profile, from its own vein tables.
 *
 * Both are derived from the same source so they can never disagree — the ore filter keys off the id
 * a deposit reports (`veinFilterId`), and the label needs the materials that id actually places.
 */
/** Pipe veins have no `projectToSurface` in the Java config: their range is always absolute. */
function projected(vein: object): boolean {
  return 'project' in vein && vein.project === true;
}

function depositIndex(
  profile: 'tfc-1.20' | 'tfg',
  extra: readonly string[] = [],
): {
  ores: string[];
  yields: Record<string, readonly string[]>;
  yRanges: Record<string, { minY: number; maxY: number; project: boolean }>;
  mix: Record<string, readonly { material: string; share: number }[]>;
  typicalBlocks: (id: string) => number | null;
} {
  const ores = [...extra];
  const yields: Record<string, readonly string[]> = {};
  const yRanges: Record<string, { minY: number; maxY: number; project: boolean }> = {};
  const mix: Record<string, readonly { material: string; share: number }[]> = {};
  for (const vein of [
    ...clusterVeinsFor(profile),
    ...discVeinsFor(profile),
    ...pipeVeinsFor(profile),
  ]) {
    const id = veinFilterId(vein.ore);
    ores.push(id);
    if (vein.produces.length > 0) yields[id] = vein.produces;
    const veinMix = veinMaterialMix(rawVeinBlocks(profile, vein.id));
    if (veinMix.length > 0) mix[id] = veinMix;
    const known = yRanges[id];
    // Veins sharing a filter id are one entry in the list, so the depths shown have to cover all of
    // them. A mixed group keeps `project` only if every member is projected, since one absolute
    // vein makes the number an absolute Y again.
    yRanges[id] = known
      ? {
          minY: Math.min(known.minY, vein.minY),
          maxY: Math.max(known.maxY, vein.maxY),
          project: known.project && projected(vein),
        }
      : { minY: vein.minY, maxY: vein.maxY, project: projected(vein) };
  }

  // Deferred: each of these walks the vein's bounding box (~150 ms for a whole profile), and both
  // cache inside. Pipe veins have no ported count, so their id is simply absent -> null.
  const counters = new Map<string, () => number | null>();
  for (const vein of clusterVeinsFor(profile)) {
    counters.set(veinFilterId(vein.ore), () => typicalVeinBlocks(vein));
  }
  for (const vein of discVeinsFor(profile)) {
    counters.set(veinFilterId(vein.ore), () => discVeinExtent(vein).typicalOreBlocks);
  }
  for (const vein of pipeVeinsFor(profile)) {
    counters.set(veinFilterId(vein.ore), () => typicalPipeVeinBlocks(vein));
  }
  const typicalBlocks = (id: string): number | null => counters.get(id)?.() ?? null;

  return { ores, yields, yRanges, mix, typicalBlocks };
}

const TFC_DEPOSITS = depositIndex('tfc-1.20');

export const TFC_1_20_PROFILE: ProfileDescriptor = {
  id: 'tfc-1.20',
  label: 'TerraFirmaCraft 1.20.x',
  mcVersion: '1.20.1',
  dimensions: ['overworld'],
  layers: [
    'biome',
    'rock',
    'temperature',
    'rainfall',
    // Terrain, relief and contours all need `surfaceY`, which this profile has. Leaving them out of
    // this list is not cosmetic: `sanitiseState` drops any enabled layer a profile does not declare,
    // so an omission here makes the layer unreachable from the UI entirely.
    'terrain',
    'hillshade',
    'contours',
    'filter',
    'minerals',
    'grid',
    'region-debug',
  ],
  biomePalette: biomePalette.colors,
  rockPalette: rockPalette.colors,
  /**
   * Every vein this profile can place, so the ore filter offers exactly what the map can show.
   *
   * Without this the filter fell back to a legacy nine-entry list while `features()` reported 37
   * vein ids, so selecting any ore matched nothing and the map went blank — the "filter on ores
   * shows nothing" report. Built from the ports rather than written out, so it cannot drift again.
   */
  depositOres: TFC_DEPOSITS.ores,
  depositYields: TFC_DEPOSITS.yields,
  depositYRanges: TFC_DEPOSITS.yRanges,
  depositMix: TFC_DEPOSITS.mix,
  typicalBlocks: TFC_DEPOSITS.typicalBlocks,
  settings: [
    {
      id: 'temperatureScale',
      labelKey: 'settings.tfc.temperatureScale',
      min: 0,
      max: 60_000,
      step: 500,
      defaultValue: 20_000,
      integer: true,
    },
    {
      id: 'temperatureConstant',
      labelKey: 'settings.tfc.temperatureConstant',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0,
    },
    {
      id: 'rainfallScale',
      labelKey: 'settings.tfc.rainfallScale',
      min: 0,
      max: 60_000,
      step: 500,
      defaultValue: 20_000,
      integer: true,
    },
    {
      id: 'rainfallConstant',
      labelKey: 'settings.tfc.rainfallConstant',
      min: -1,
      max: 1,
      step: 0.05,
      defaultValue: 0,
    },
    {
      id: 'continentalness',
      labelKey: 'settings.tfc.continentalness',
      min: 0,
      max: 1,
      step: 0.05,
      defaultValue: 0.5,
    },
  ],
};

/**
 * `BiomeSourceExtension.getBiomeExtension`'s river threshold: `edge.fractal().intersect(x, z, 0.08f)`
 * in grid units, so roughly 10 blocks either side of the fractal's centreline.
 */
const RIVER_QUART_WIDTH = Math.fround(0.08);

export class Tfc120Generator implements WorldGenerator {
  readonly profile = TFC_1_20_PROFILE;
  readonly seed: bigint;
  readonly dimension: DimensionId;
  protected readonly region: RegionGenerator;
  private readonly surfaceHeightSampler: SurfaceHeightSampler;

  constructor(options: GeneratorOptions) {
    this.seed = options.seed;
    this.dimension = options.dimension;
    const settings = options.settings ?? {};
    this.region = this.createRegionGenerator(options.seed, {
      temperatureScale: settings.temperatureScale ?? 20_000,
      temperatureConstant: settings.temperatureConstant ?? 0,
      rainfallScale: settings.rainfallScale ?? 20_000,
      rainfallConstant: settings.rainfallConstant ?? 0,
      continentalness: settings.continentalness ?? 0.5,
    });
    this.surfaceHeightSampler = new SurfaceHeightSampler(
      options.seed,
      (quartX, quartZ) => this.region.biomeAtQuart(quartX, quartZ),
      // River carving. The same partition the biome layer uses, so the valley lands under the
      // river rather than beside it.
      (blockX, blockZ) => this.region.riversAtGrid(blockToGrid(blockX), blockToGrid(blockZ)),
    );
  }

  protected createRegionGenerator(
    seed: bigint,
    settings: import('./region/generator').RegionGeneratorSettings,
  ): RegionGenerator {
    return new RegionGenerator(seed, settings);
  }

  climate(x: number, z: number): ClimateSample {
    return sampleClimate(this.region, Math.floor(x), Math.floor(z));
  }

  /** The abstract stack plus `RockData.getSurfaceRock`'s layer-zero, laterally skewed sample. */
  rocks(x: number, z: number): RockStack | null {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    const pointRock = this.region.rockAt(blockX, blockZ);
    return {
      ...rockStackAtPoint(pointRock),
      surface: sampleAtLayer(this.region.surfaceRockAt(blockX, blockZ), 0),
    };
  }

  /**
   * `RegionBiomeSource.getNoiseBiome(quartX, quartZ)`: samples the fully-zoomed quart-scale biome
   * layer the region generator builds in its constructor (`RegionGenerator.biomeAtQuart`, ported
   * from `TFCLayers.createRegionBiomeLayer`) and maps the internal `TFCLayers` int id to its
   * datapack biome id (`./biome/ids.ts`'s `biomeId`).
   */
  biome(x: number, z: number): string | null {
    const quartX = blockToQuart(Math.floor(x));
    const quartZ = blockToQuart(Math.floor(z));
    return biomeId(this.biomeAtQuartWithRivers(quartX, quartZ));
  }

  /**
   * `BiomeSourceExtension.getBiomeExtension(quartX, quartZ)`: the quart biome layer, then the river
   * carved through it.
   *
   * Java keeps two accessors and the difference matters. `getBiomeExtensionNoRiver` is what the
   * terrain path uses (`TFCChunkGenerator` line 535, and so `ChunkHeightFiller`), because
   * `tfc:river` has no height map of its own — it takes the height of whatever it flows through. The
   * river-aware one is what the player sees. So this wraps `biomeAtQuart` here rather than inside
   * the region generator, leaving the surface-height sampler on the river-free layer where it
   * belongs.
   */
  private biomeAtQuartWithRivers(quartX: number, quartZ: number): number {
    const biome = this.region.biomeAtQuart(quartX, quartZ);
    if (!hasRivers(biome)) return biome;

    // The partition is looked up on the whole grid cell, the fractal tested at the exact fractional
    // position -- `Units.quartToGrid` is an arithmetic shift, so it floors for negative coordinates
    // the same way Java's does.
    const gridX = quartToGridExact(quartX);
    const gridZ = quartToGridExact(quartZ);
    for (const edge of this.region.riversAtGrid(quartToGrid(quartX), quartToGrid(quartZ))) {
      if (edge.fractal.intersect(gridX, gridZ, RIVER_QUART_WIDTH)) return Biome.RIVER;
    }
    return biome;
  }

  regionDebug(x: number, z: number): RegionDebugSample {
    const cell = this.region.sampleCell(blockToGrid(Math.floor(x)), blockToGrid(Math.floor(z)));
    return {
      id: `${cell.cx},${cell.cy}`,
      centerX: cell.x * GRID_WIDTH_IN_BLOCK,
      centerZ: cell.y * GRID_WIDTH_IN_BLOCK,
    };
  }

  surfaceY(x: number, z: number): number | null {
    return this.surfaceHeightSampler.sample(x, z);
  }

  /**
   * `Region.Point`'s landform fields at the single grid point `(x, z)` falls in — see
   * `TerrainSample`'s doc comment for why this is a direct read, not an interpolation.
   */
  terrain(x: number, z: number): TerrainSample {
    const point = this.region.getOrCreateRegionPoint(
      blockToGrid(Math.floor(x)),
      blockToGrid(Math.floor(z)),
    );
    return {
      land: point.land(),
      island: point.island(),
      mountain: point.mountain(),
      coastalMountain: point.coastalMountain(),
      distanceToOcean: point.distanceToOcean,
      distanceToEdge: point.distanceToEdge,
      baseLandHeight: point.baseLandHeight,
      biomeAltitude: point.biomeAltitude,
    };
  }

  probe(x: number, z: number): Probe {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    const cell = this.region.sampleCell(blockToGrid(blockX), blockToGrid(blockZ));
    return {
      x,
      z,
      chunkX: blockToChunk(blockX),
      chunkZ: blockToChunk(blockZ),
      // The owning Voronoi site's lattice id, not floor(block / nominal cell width).
      regionX: cell.cx,
      regionZ: cell.cy,
      regionDebug: this.regionDebug(blockX, blockZ),
      biome: this.biome(blockX, blockZ),
      climate: this.climate(blockX, blockZ),
      rocks: this.rocks(blockX, blockZ),
      terrain: this.terrain(blockX, blockZ),
      surfaceY: this.surfaceY(blockX, blockZ),
    };
  }

  /**
   * The hover readout's fast path (`WorldGenerator.probeFast`): position fields are always cheap
   * (`sampleCell` is a Voronoi lookup, not a region build), so those are always filled in. The
   * climate/rock/biome/terrain fields are gated on `RegionGenerator.isRegionCached` for the grid
   * cell the position falls in — when that region has not been built yet, calling `climate()`/
   * `rocks()`/`biome()`/`terrain()` would trigger the (potentially hundreds-of-milliseconds) task
   * pipeline synchronously, so this returns `null` for them instead and lets the caller fall back
   * to the worker-routed `probe()`.
   *
   * This is a single-cell approximation, not a guarantee: `climate()` interpolates the four grid
   * points around the position's containing chunk, and the biome/rock layers can occasionally
   * sample a neighbouring cell too (real TFC "region" ownership is Voronoi-shaped, not square) — so
   * a hover right at a region boundary can still, rarely, trigger one bounded region build here.
   * That is no worse than an ordinary cache miss the pool already handles elsewhere; it is simply
   * not pre-announced by this check. Never a source of a fabricated value either way.
   */
  probeFast(x: number, z: number): Probe {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    const gridX = blockToGrid(blockX);
    const gridZ = blockToGrid(blockZ);
    const cell = this.region.sampleCell(gridX, gridZ);
    const ready = this.region.isRegionCached(gridX, gridZ);
    return {
      x,
      z,
      chunkX: blockToChunk(blockX),
      chunkZ: blockToChunk(blockZ),
      regionX: cell.cx,
      regionZ: cell.cy,
      regionDebug: {
        id: `${cell.cx},${cell.cy}`,
        centerX: cell.x * GRID_WIDTH_IN_BLOCK,
        centerZ: cell.y * GRID_WIDTH_IN_BLOCK,
      },
      biome: ready ? this.biome(blockX, blockZ) : null,
      climate: ready ? this.climate(blockX, blockZ) : null,
      rocks: ready ? this.rocks(blockX, blockZ) : null,
      terrain: ready ? this.terrain(blockX, blockZ) : null,
      // Height blending samples a wide biome neighbourhood, so keep the hover fast path cold.
      surfaceY: ready ? this.surfaceY(blockX, blockZ) : null,
    };
  }

  /**
   * Disc-shaped ore/mineral veins only (this phase -- see `./features/disc-vein.ts`'s header for
   * exactly which of TFC's 11 `disc` veins are excluded and why). Cluster/pipe veins and
   * structures are future phases; `structures` stays empty rather than a guess.
   */
  features(
    box: BlockBox,
    kinds: readonly FeatureKind[] = ['deposits', 'structures'],
    ores: readonly string[] = [],
  ): FeatureSet {
    // This profile places no structures yet, so a structures-only request has nothing to compute.
    if (!kinds.includes('deposits')) return { deposits: [], structures: [] };
    const wanted = <T extends { readonly ore: string }>(veins: readonly T[]): T[] =>
      ores.length === 0 ? [...veins] : veins.filter((vein) => ores.includes(veinFilterId(vein.ore)));
    const biomeAt = (x: number, z: number): string | null => this.biome(x, z);
    // A vein only places where its table has an entry for the rock present -- see `columnCanHost`.
    // Dikes rewrite the host rock where they pass -- see features/dike.ts.
    const dikes = dikesInBox(box, this.seed, 'tfc-1.20');
    const rockAt = (bx: number, by: number, bz: number): string | null => {
      // A dike decorates after the ore veins and overwrites them -- see DIKE_OVERWRITES.
      if (dikeRockAt(dikes, bx, by, bz) !== null) return DIKE_OVERWRITES;
      const surface = this.surfaceY(bx, bz);
      if (surface === null) return null;
      const { point, layer } = this.region.rockLayerAtY(
        Math.floor(bx),
        Math.floor(by),
        Math.floor(bz),
        surface,
      );
      return sampleAtLayer(point, layer);
    };
    const discs = discDepositsInBox(
      box,
      this.seed,
      biomeAt,
      wanted(discVeinsFor('tfc-1.20')),
      (bx, bz) => this.surfaceY(bx, bz),
      rockAt,
    );
    return {
      // Depth below surface is filled in once here, at generation time, and stored on the feature.
      // Exposure stays 'unknown' -- see `resolveDepositDepth` for why surface height alone cannot
      // answer it.
      deposits: resolveDepositDepth(
        [
          ...filterDiscDepositsByClimate(discs, (x, z) => this.climate(x, z)),
          // TFC's own 24 cluster veins -- the same port TFG uses, against TFC's vein table.
          ...clusterDepositsInBox(
            box,
            this.seed,
            biomeAt,
            wanted(clusterVeinsFor('tfc-1.20')),
            (bx, bz) => this.surfaceY(bx, bz),
            rockAt,
          ),
          // Pipe veins are where the gems are -- diamond and emerald on TFC.
          ...pipeDepositsInBox(box, this.seed, biomeAt, wanted(pipeVeinsFor('tfc-1.20')), rockAt),
        ],
        box,
        (x, z) => this.surfaceY(x, z),
      ),
      structures: [],
    };
  }
}

registerProfile(TFC_1_20_PROFILE, (options) => new Tfc120Generator(options));

export {};
