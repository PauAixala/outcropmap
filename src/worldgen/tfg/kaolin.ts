/** Installed TFG kaolin configuration and biome tag, preserving TFC vein seed semantics. */
import data from '@data/tfg/kaolin.json';
import {
  findDiscVeinInChunk,
  veinNameSeed,
  type DiscVeinDef,
} from '../tfc-1.20/features/disc-vein';
import type { BlockBox, ClimateSample, DepositFeature } from '../api/types';
const config = data.configuredFeature.config;
export const KAOLIN_BIOMES: ReadonlySet<string> = new Set(data.biomes);
export const KAOLIN: DiscVeinDef = {
  id: 'kaolin_disc',
  ore: 'tfc:kaolin',
  kind: 'mineral',
  rarity: config.rarity,
  minY: config.min_y,
  maxY: config.max_y,
  size: config.size,
  height: config.height,
  density: config.density,
  hasIndicator: true,
  // TFG's kaolin comes from KubeJS, not a datapack vein, and defines no indicator.
  indicator: null,
  project: false,
  projectOffset: false,
  biomeTag: 'tfc:kaolin_clay_spawns_in',
  hostRock: '',
  // Kaolin replaces soil, not rock, so the rock table -- and the check that uses it -- is empty.
  hostRockIds: new Set<string>(),
  nameSeed: veinNameSeed(config.random_name),
    // TFG's kaolin comes from the modpack's KubeJS config, not a vein table, so it has no
    // block-replacement map to derive materials from.
    produces: ['kaolin'],
};

export function kaolinInBox(
  box: BlockBox,
  seed: bigint,
  biomeAt: (x: number, z: number) => string | null,
  climateAt: (x: number, z: number) => ClimateSample,
): DepositFeature[] {
  const deposits: DepositFeature[] = [];
  const placement = data.placedFeature.placement[0]!;
  for (let cz = box.minZ >> 4; cz <= box.maxZ >> 4; cz++)
    for (let cx = box.minX >> 4; cx <= box.maxX >> 4; cx++) {
      const deposit = findDiscVeinInChunk(seed, KAOLIN, cx, cz, biomeAt, () => KAOLIN_BIOMES);
      if (!deposit) continue;
      let eligible = false;
      for (
        let z = (deposit.z - KAOLIN.size) >> 4;
        z <= (deposit.z + KAOLIN.size) >> 4 && !eligible;
        z++
      ) {
        for (let x = (deposit.x - KAOLIN.size) >> 4; x <= (deposit.x + KAOLIN.size) >> 4; x++) {
          const climate = climateAt(x * 16, z * 16);
          if (
            climate.temperature >= placement.min_temperature &&
            climate.rainfall >= placement.min_rainfall
          ) {
            eligible = true;
            break;
          }
        }
      }
      // Necessary placement gates, not proof that terrain contains replaceable blocks.
      if (eligible) deposits.push(deposit);
    }
  return deposits;
}
