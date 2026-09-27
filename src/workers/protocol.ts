/**
 * Typed messages between the main thread and the generation workers.
 * Raster results are transferred as ImageBitmap; vector results as plain serialisable arrays.
 */
import type { BlockBox, DimensionId, FeatureSet, GeneratorSettings, LayerId, Probe, ProfileId, FeatureKind } from '@worldgen/api/types';
import type { MapFilter } from '@layers/filter';

export interface WorkerInit {
  readonly type: 'init';
  readonly seed: string; // bigint is not structured-cloneable across all paths; send as a string
  readonly profile: ProfileId;
  readonly dimension: DimensionId;
  readonly settings: GeneratorSettings;
}

export interface TileRequest {
  readonly type: 'tile';
  readonly id: number;
  readonly layer: LayerId;
  readonly zoom: number;
  readonly tileX: number;
  readonly tileZ: number;
  /** Resolved theme colours, so workers never touch the DOM. */
  readonly palette: Record<string, number>;
  /** Only meaningful for the `filter` layer -- see `RasterLayer.render`'s doc comment
   * (src/layers/types.ts). Not part of the tile cache key; a value change is handled by an
   * explicit `TileManager.invalidateLayer('filter')` instead (docs/ARCHITECTURE.md "Caching"). */
  readonly filter?: MapFilter;
  /** Height-field density for refinable layers (`RasterLayer.render`'s `detail`); absent means 0. */
  readonly detail?: number;
}

export interface FeatureRequest {
  readonly type: 'features';
  readonly id: number;
  readonly box: BlockBox;
  /** Which kinds to compute (`WorldGenerator.features`); absent means both. */
  readonly kinds?: readonly FeatureKind[];
  /** Which ores to generate deposits for (filter ids); absent or empty means every ore. */
  readonly ores?: readonly string[];
}

export interface ProbeRequest {
  readonly type: 'probe';
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export interface CancelRequest {
  readonly type: 'cancel';
  readonly id: number;
}

export type WorkerRequest =
  | WorkerInit
  | TileRequest
  | FeatureRequest
  | ProbeRequest
  | CancelRequest;

export interface TileResponse {
  readonly type: 'tile';
  readonly id: number;
  readonly bitmap: ImageBitmap;
}

export interface FeatureResponse {
  readonly type: 'features';
  readonly id: number;
  readonly features: FeatureSet;
}

export interface ProbeResponse {
  readonly type: 'probe';
  readonly id: number;
  readonly probe: Probe;
}

export interface ErrorResponse {
  readonly type: 'error';
  readonly id: number;
  readonly message: string;
}

export type WorkerResponse =
  | TileResponse
  | FeatureResponse
  | ProbeResponse
  | ErrorResponse;
