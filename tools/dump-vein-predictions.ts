/**
 * Every marker the map would draw in a box, written as JSON for `verify-veins.py` to check against a
 * real save.
 *
 * The map predicts veins from the seed alone; only a generated world can say whether the game put
 * ore there. Pau dug to three markers that held nothing, and the answers turned out to be different
 * each time — see docs/WORLDGEN-NOTES.md. This pair of tools is how that question gets answered with
 * numbers instead of anecdotes.
 *
 * Usage:
 *   npx vite-node tools/dump-vein-predictions.ts <out.json> <profile> <seed> <centreX> <centreZ> <half> [dimension]
 *
 * `dimension` defaults to `overworld`. The other dimensions have their own vein tables, so the
 * block list a hit is recognised by comes from the table that dimension actually draws from.
 */
import '@worldgen/profiles';
import { writeFileSync } from 'node:fs';
import { createGenerator } from '@worldgen/registry';
import { veinFilterId, type DepositFeature, type ProfileId } from '@worldgen/api/types';
import { RAW_VEINS_BY_PROFILE, type VeinProfileId } from '@worldgen/tfc-1.20/features/vein-tables';
import { VEIN_SET_BY_DIMENSION } from '@worldgen/tfg';
import type { DimensionId } from '@worldgen/api/types';

const [outPath, profileArg, seedArg, xArg, zArg, halfArg, dimensionArg] = process.argv.slice(2);
const profile = (profileArg ?? 'tfg') as ProfileId;
const seed = BigInt(seedArg ?? '0');
const centreX = Number(xArg ?? 0);
const centreZ = Number(zArg ?? 0);
const half = Number(halfArg ?? 512);
const dimension = (dimensionArg ?? 'overworld') as DimensionId;

const set: VeinProfileId =
  profile === 'tfg' ? (VEIN_SET_BY_DIMENSION[dimension] ?? 'tfg') : 'tfc-1.20';
const veins = RAW_VEINS_BY_PROFILE[set];

/** Everything this vein can place, so a hit can be recognised whatever the host rock is. */
function blockIdsOf(id: string): string[] {
  const out = new Set<string>();
  for (const entries of Object.values(veins[id]?.blocks ?? {})) {
    for (const entry of entries) if (entry?.block) out.add(entry.block);
  }
  return [...out];
}

const generator = createGenerator(profile, { seed, dimension });
const box = { minX: centreX - half, minZ: centreZ - half, maxX: centreX + half, maxZ: centreZ + half };
const deposits = (generator.features?.(box, ['deposits'], []).deposits ?? []) as DepositFeature[];

const rows = deposits.map((deposit) => {
  const id = veinFilterId(deposit.ore);
  return {
    id,
    x: deposit.x,
    z: deposit.z,
    y0: deposit.bottomY,
    y1: deposit.topY,
    // How far under the surface the middle of the band sits -- the strongest predictor of whether
    // a marker is real that we have found, see `markerConfidence`.
    depth:
      deposit.surfaceY === null
        ? null
        : deposit.surfaceY - Math.round((deposit.bottomY + deposit.topY) / 2),
    radius: veins[id]?.size ?? veins[id]?.radius ?? 16,
    blocks: blockIdsOf(id),
  };
});

writeFileSync(outPath ?? 'predictions.json', JSON.stringify({ profile, dimension, seed: String(seed), box, deposits: rows }));
console.log(`wrote ${rows.length} markers for ${box.minX}..${box.maxX} x ${box.minZ}..${box.maxZ}`);
