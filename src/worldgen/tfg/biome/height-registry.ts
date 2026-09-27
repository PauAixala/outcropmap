/**
 * Maps the function names in TFG's extracted height expressions to their ports.
 *
 * The names come from `TFGBiomes.java` via `tools/extract-tfg-biome-heights.mjs`; the
 * implementations are TFC's `BiomeNoise` (already ported for the `tfc-1.20` profile), TFG's own
 * `TFGBiomeNoise`, and `TFGNoiseHelpers`. Anything not in this table makes its biome unavailable
 * rather than approximated — see `./surface-height.ts`.
 *
 * Argument lists are positional and follow the Java, minus the leading `seed`, which
 * `evaluateHeightExpression` passes separately because every factory takes it.
 */
import {
  canyons,
  hills,
  lake,
  lowlands,
  mountains,
  ocean,
  oceanRidge,
  shore,
} from '@worldgen/tfc-1.20/biome/biome-noise';
import { chain, NoiseChain } from '../noise/noise-chain';
import { addConstant, maxOf, minOf } from '../noise/noise-helpers';
import { hotspotFields } from '../noise/hotspots';
import * as tfg from '../noise/biome-noise';
import type { HeightFunction, HeightRegistry } from './height-expression';

/** Coerces an evaluated argument to a chain — the nested calls come back as one already. */
function asChain(value: unknown): NoiseChain {
  if (value instanceof NoiseChain) return value;
  if (typeof value === 'function') return chain(value as (x: number, z: number) => number);
  throw new Error('expected a noise field argument');
}

function num(value: unknown): number {
  if (typeof value !== 'number') throw new Error('expected a numeric argument');
  return value;
}

/** Wraps a plain `Noise2D`-returning TFC factory. */
function tfc(fn: (seed: bigint, ...args: number[]) => (x: number, z: number) => number): HeightFunction {
  return (seed, args) => chain(fn(seed, ...args.map(num)));
}

export function createHeightRegistry(seed: bigint): HeightRegistry {
  // One hotspot field per seed, shared by every volcano biome — they are the same world features.
  const hotspots = hotspotFields(seed);
  const hotspotIntensity = chain((x: number, z: number) => hotspots.intensityAtBlock(x, z));

  const registry: Record<string, HeightFunction> = {
    // --- TFC's BiomeNoise, reused unchanged -------------------------------------------------
    ocean: tfc(ocean),
    oceanRidge: tfc(oceanRidge),
    hills: tfc(hills),
    canyons: tfc(canyons),
    mountains: tfc(mountains),
    lowlands: tfc(lowlands),
    lake: tfc(lake),
    shore: tfc(shore),

    // --- TFGNoiseHelpers --------------------------------------------------------------------
    max: (_seed, args) => chain(maxOf(asChain(args[0]).fn, asChain(args[1]).fn)),
    min: (_seed, args) => chain(minOf(asChain(args[0]).fn, asChain(args[1]).fn)),
    addConstant: (_seed, args) => chain(addConstant(asChain(args[0]).fn, num(args[1]))),

    // --- TFGBiomeNoise: flats and dunes -----------------------------------------------------
    flats: (s) => tfg.flats(s),
    saltFlats: (s) => tfg.saltFlats(s),
    dunes: (s, a) => tfg.dunes(s, num(a[0]), num(a[1])),
    constant: (_s, a) => tfg.constant(num(a[0])),

    // --- Arid ------------------------------------------------------------------------------
    sharpHills: (s, a) => tfg.sharpHills(s, num(a[0]), num(a[1])),
    badlands: (s, a) => tfg.badlands(s, num(a[0]), num(a[1])),
    rockyIslands: (s) => tfg.rockyIslands(s),
    stairCanyons: (s) => tfg.stairCanyons(s),
    mesas: (s) => tfg.mesas(s),
    buttes: (s) => tfg.buttes(s),
    hoodoos: (s) => tfg.hoodoos(s),

    // --- Karst -----------------------------------------------------------------------------
    fenglin: (s, a) => tfg.fenglin(s, asChain(a[0]), num(a[1])),
    fengcong: (s, a) => tfg.fengcong(s, asChain(a[0])),
    shilin: (s, a) => tfg.shilin(s, asChain(a[0]), num(a[1])),
    burren: (s, a) => tfg.burren(s, asChain(a[0]), num(a[1])),
    bowlDolines: (s, a) => tfg.bowlDolines(s, asChain(a[0]), num(a[1])),
    cenotes: (s, a) => tfg.cenotes(s, asChain(a[0]), num(a[1]), num(a[2])),
    tiankeng: (s, a) => tfg.tiankeng(s, asChain(a[0])),

    // --- Glacial ---------------------------------------------------------------------------
    glacialBase: (s) => tfg.glacialBase(s),
    glacialCirques: (s) => tfg.glacialCirques(s),
    glacialCirquesIceSurfaceHeight: (s) => tfg.glacialCirquesIceSurfaceHeight(s),
    glacialSurfaceTexture: (s) => tfg.glacialSurfaceTexture(s),
    iceSheetSurfaceHeight: (s) => tfg.iceSheetSurfaceHeight(s),
    montaneIceSheetSurfaceHeight: (s) => tfg.montaneIceSheetSurfaceHeight(s),
    oceanicIceSheetSurfaceHeight: (s) => tfg.oceanicIceSheetSurfaceHeight(s),
    knobAndKettle: (s) => tfg.knobAndKettle(s),
    drumlins: (s) => tfg.drumlins(s),
    patternedGround: (s) => tfg.patternedGround(s),
    invertedPatternedGround: (s) => tfg.invertedPatternedGround(s),
    stoneCircles: (s) => tfg.stoneCircles(s),

    // --- Volcanic ---------------------------------------------------------------------------
    // The hotspot argument is not written in the biome expressions; TFG passes the shared
    // intensity field, so it is supplied here rather than parsed.
    hotSpotIntensity: () => hotspotIntensity,
    // The four stages of a hotspot chain, in TFG's own order. A volcano biome takes the one that
    // matches its age, which is what puts active and extinct volcanoes in different places.
    activeHotSpots: () => chain(hotspots.ageFieldAtBlock(0)),
    dormantHotSpots: () => chain(hotspots.ageFieldAtBlock(1)),
    extinctHotSpots: () => chain(hotspots.ageFieldAtBlock(2)),
    ancientHotSpots: () => chain(hotspots.ageFieldAtBlock(3)),
    activeShieldVolcano: (s, a) => tfg.activeShieldVolcano(s, hotspotOrShared(a[0])),
    dormantShieldVolcano: (s, a) => tfg.dormantShieldVolcano(s, hotspotOrShared(a[0])),
    extinctShieldVolcano: (s, a) => tfg.extinctShieldVolcano(s, hotspotOrShared(a[0])),
    glaciatedShieldVolcano: (s, a) => tfg.glaciatedShieldVolcano(s, hotspotOrShared(a[0])),
    sunkenShieldVolcano: (s, a) => tfg.sunkenShieldVolcano(s, hotspotOrShared(a[0])),
    ancientShieldVolcano: (s, a) =>
      tfg.ancientShieldVolcano(s, num(a[0]), num(a[1]), hotspotOrShared(a[2])),
    shieldVolcanoIceSheetSurface: (s, a) =>
      tfg.shieldVolcanoIceSheetSurface(s, hotspotOrShared(a[0])),
    shieldVolcanoGlacierSurface: (s, a) =>
      tfg.shieldVolcanoGlacierSurface(s, hotspotOrShared(a[0])),
  };

  /** A volcano's hotspot argument, defaulting to the shared intensity field when absent. */
  function hotspotOrShared(value: unknown): NoiseChain {
    return value === undefined ? hotspotIntensity : asChain(value);
  }

  return registry;
}
