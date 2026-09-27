/**
 * Rock layer stack (bottom/middle/top) and rock-category assignment. Phase 5. Ported:
 * `ChooseRocks` (`../biome/choose.ts`'s `chooseRocks`, run by `RegionGenerator.createRegion`),
 * `RockLayerSettings` (`./layer-settings.ts`), and `TFCLayers.createOverworldRockLayer`
 * (`./layer.ts`) -- all three fixture-verified bit-exact against real compiled TFC source
 * (tests/parity/tfc-1.20-rocks.parity.test.ts, tests/parity/tfc-1.20-biomes.parity.test.ts for
 * `ChooseRocks` itself). What "bottom"/"middle"/"top" mean for this port — and what genuinely
 * cannot be ported without real surface height (the `surface` field) — is documented in
 * `docs/WORLDGEN-NOTES.md`'s "Rock layers" section and `docs/PARITY.md`.
 */
export { sampleAtLayer, bottomDepthFor, knownRockIds } from './layer-settings';
export { overworldRockLayer } from './layer';
