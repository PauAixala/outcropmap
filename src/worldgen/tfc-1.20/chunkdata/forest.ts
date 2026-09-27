/**
 * `net.dries007.tfc.world.layer.TFCLayers.createOverworldForestLayer` and its layers
 * (`ForestInitLayer`, `ForestRandomizeLayer`, `ForestEdgeLayer`, `ForestRandomizeSmallLayer`),
 * TFC 1.20.x. Sampled per **chunk**: `RegionChunkDataGenerator.generate` reads it at
 * `(blockX >> 4, blockZ >> 4)`.
 *
 * Needed for structure placement: `tfc:climate` structure sets (TerraFirmaGreg's villages, camps
 * and houses) gate on the chunk's forest type through `ClimatePlacement.isValid`.
 *
 * @unverified No golden fixture of forest types exists. Its consequences are checked indirectly by
 * tests/parity/tfg-world-structures.parity.test.ts, against structures in a real saved world.
 */
import { JavaRandom } from '@core/random';
import { OpenSimplex2D } from '../noise/open-simplex-2d';
import {
  adjacentTransformArea,
  centerTransformArea,
  fuzzyZoomArea,
  sourceArea,
  zoomArea,
  type Area,
} from '../biome/area';

/** `ForestType` ordinals, which are also `TFCLayers.FOREST_*`. */
export const FOREST_NONE = 0;
export const FOREST_SPARSE = 1;
export const FOREST_EDGE = 2;
export const FOREST_NORMAL = 3;
export const FOREST_OLD = 4;

/** `ForestType.getSerializedName`, for data that names forest types (`ClimatePlacement`). */
export const FOREST_TYPE_NAMES = ['none', 'sparse', 'edge', 'normal', 'old_growth'] as const;

/** `ForestRandomizeLayer.apply`. */
function randomize(value: number, nextInt: (bound: number) => number): number {
  if (value === FOREST_NONE) {
    const random = nextInt(16);
    if (random <= 2) return FOREST_SPARSE;
    if (random === 3) return FOREST_NORMAL;
  } else if (value === FOREST_SPARSE) {
    if (nextInt(7) <= 3) return FOREST_NORMAL;
  } else if (value === FOREST_NORMAL || value === FOREST_OLD) {
    const random = nextInt(24);
    if (random === 1 && value !== FOREST_OLD) return FOREST_SPARSE;
    if (random === 2) return FOREST_NONE;
    if (random <= 6) return FOREST_OLD;
  }
  return value;
}

const isFullForest = (value: number): boolean => value === FOREST_NORMAL || value === FOREST_OLD;

/** `ForestEdgeLayer.apply`. */
function edge(north: number, east: number, south: number, west: number, center: number): number {
  if (isFullForest(center) && (!isFullForest(north) || !isFullForest(east) || !isFullForest(south) || !isFullForest(west))) {
    return FOREST_EDGE;
  }
  return center;
}

/** `ForestRandomizeSmallLayer.apply`. */
function randomizeSmall(value: number, nextInt: (bound: number) => number): number {
  if (value === FOREST_NORMAL || value === FOREST_OLD) {
    const random = nextInt(value === FOREST_OLD ? 40 : 25);
    if (random === 0) return FOREST_NONE;
    if (random === 1) return FOREST_SPARSE;
  } else if (value === FOREST_SPARSE || value === FOREST_NONE) {
    if (nextInt(30) === 0) return value === FOREST_SPARSE ? FOREST_NORMAL : FOREST_EDGE;
  }
  return value;
}

/** `TFCLayers.createOverworldForestLayer(long seed, IArtist)`: a chunk-resolution forest type area. */
export function overworldForestLayer(seed: bigint): Area {
  const random = new JavaRandom(seed);
  const baseNoise = new OpenSimplex2D(random.nextInt()).spread(Math.fround(0.3));

  // `ForestInitLayer`: `(float) forestBaseNoise.noise(x, z) < 0 ? FOREST_NONE : FOREST_NORMAL`.
  let layer = sourceArea(random.nextLong(), (x, z) =>
    Math.fround(baseNoise.noise(x, z)) < 0 ? FOREST_NONE : FOREST_NORMAL,
  );
  layer = centerTransformArea(random.nextLong(), layer, randomize);
  layer = fuzzyZoomArea(random.nextLong(), layer);
  layer = centerTransformArea(random.nextLong(), layer, randomize);
  layer = fuzzyZoomArea(random.nextLong(), layer);
  layer = zoomArea(random.nextLong(), layer);
  layer = adjacentTransformArea(random.nextLong(), layer, edge);
  layer = centerTransformArea(random.nextLong(), layer, randomizeSmall);
  for (let i = 0; i < 2; i++) layer = zoomArea(random.nextLong(), layer);
  return layer;
}
