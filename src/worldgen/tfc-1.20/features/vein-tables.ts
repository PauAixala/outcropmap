/**
 * Which vein table each set of veins comes from.
 *
 * One list rather than the same three-line map copied into `cluster-vein.ts`, `disc-vein.ts` and
 * `pipe-vein.ts`: those three read the *same* JSON and differ only in which shapes they keep, so a
 * new table added to two of the three is a silently empty dimension.
 *
 * A "vein set" is not a profile. TerraFirmaGreg keeps a vein folder per dimension —
 * `configured_feature/{earth,nether,moon,mars,venus}/vein` — and those are separate tables of
 * separate veins, so they are separate keys here. `tools/extract-datapack.mjs --dimension <name>`
 * writes each one.
 */
import tfcVeinsData from '@data/tfc-1.20/veins.json';
import tfgVeinsData from '@data/tfg/veins.json';
import tfgNetherVeins from '@data/tfg/veins-nether.json';
import tfgMoonVeins from '@data/tfg/veins-moon.json';
import tfgMarsVeins from '@data/tfg/veins-mars.json';
import tfgVenusVeins from '@data/tfg/veins-venus.json';

/** Raw shape of one entry in a `veins.json` `veins` map -- see `tools/extract-datapack.mjs`'s
 * `extractVeins` for exactly which Java field each key mirrors. */
export interface RawVein {
  readonly id: string;
  readonly type: string;
  readonly rarity: number | null;
  readonly size: number | null;
  readonly height?: number;
  readonly density: number | null;
  readonly min_y: number | null;
  readonly max_y: number | null;
  readonly random_name: string | null;
  readonly blocks: Readonly<Record<string, readonly { block: string; weight: number }[]>>;
  readonly biomes?: string;
  readonly indicator?: unknown;
  readonly project?: boolean;
  readonly project_offset?: boolean;
  readonly near_lava?: boolean;
  readonly radius?: number;
  readonly min_skew?: number;
  readonly max_skew?: number;
  readonly min_slant?: number;
  readonly max_slant?: number;
  readonly sign?: number;
}

export type VeinProfileId =
  | 'tfc-1.20'
  | 'tfg'
  | 'tfg-nether'
  | 'tfg-moon'
  | 'tfg-mars'
  | 'tfg-venus';

const table = (data: unknown): Readonly<Record<string, RawVein>> =>
  (data as { veins: Readonly<Record<string, RawVein>> }).veins;

export const RAW_VEINS_BY_PROFILE: Readonly<Record<VeinProfileId, Readonly<Record<string, RawVein>>>> =
  {
    'tfc-1.20': table(tfcVeinsData),
    tfg: table(tfgVeinsData),
    'tfg-nether': table(tfgNetherVeins),
    'tfg-moon': table(tfgMoonVeins),
    'tfg-mars': table(tfgMarsVeins),
    'tfg-venus': table(tfgVenusVeins),
  };
