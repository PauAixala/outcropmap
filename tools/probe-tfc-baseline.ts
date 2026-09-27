/** Repeatable TFC-vs-TFG probe at the user-reported coordinates.
 * Usage: vite-node tools/probe-tfc-baseline.ts [seed]
 */
import '../src/worldgen/profiles';
import { createGenerator } from '../src/worldgen/registry';

const seed = BigInt(process.argv[2] ?? '-6696614430994881185');
const points = [
  { x: 0, z: 3700, observationSource: 'USER', reportedBiome: 'Plateau wide' },
  { x: 2600, z: 4400, observationSource: 'USER', reportedBiome: 'Plains' },
  { x: -300, z: 7300, observationSource: 'USER', reportedBiome: 'Buttes' },
];
const tfc = createGenerator('tfc-1.20', { seed, dimension: 'overworld' });
const tfg = createGenerator('tfg', { seed, dimension: 'overworld' });
const observations = points.map((point) => ({
  ...point,
  computedTfc: tfc.probe(point.x, point.z),
  computedTfg: tfg.probe(point.x, point.z),
}));
console.log(
  JSON.stringify(
    { profiles: [tfc.profile.id, tfg.profile.id], seed: seed.toString(), points: observations },
    null,
    2,
  ),
);
