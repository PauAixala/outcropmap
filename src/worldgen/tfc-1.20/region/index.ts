/**
 * Region grid: coordinate transforms (`./units`) plus the climate-relevant subset of plate
 * tectonics (`./region`, `./tasks`, `./generator`) — Voronoi cell partitioning, continents/oceans,
 * islands, distance-to-ocean/edge, and `AnnotateClimate`'s bias correction. Full plate tectonics
 * (mountains, rivers, base land height, biome altitude) is Phase 4 — see docs/PLAN.md and
 * docs/WORLDGEN-NOTES.md.
 */
export * from './units';
export * from './region';
export * from './generator';
