/**
 * Vector feature placement for the tfc-1.20 profile: disc-shaped ore/mineral veins (this phase).
 * Cluster and pipe veins, structures, and the surface-relative disc veins (`bituminous_coal`,
 * `halite`, `lignite` -- see `./disc-vein.ts`'s header) are out of scope here.
 */
export {
  discDepositsInBox,
  discVeinsFor,
  filterDiscDepositsByClimate,
  SUPPORTED_DISC_VEINS,
} from './disc-vein';
export type { DiscVeinDef } from './disc-vein';
export * from './cluster-vein';
export * from './dike';
export * from './metaballs-3d';
export * from './pipe-vein';
export * from './vein-materials';
