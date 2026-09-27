/** Ordered rock settings captured from the installed TFG world's level.dat. */
import data from '@data/tfg/rock-layers.json';
import { createRockLayerSampler, type RockLayersJson } from '../tfc-1.20/rock/layer-settings';
export const tfgRocks = createRockLayerSampler(data as unknown as RockLayersJson);
