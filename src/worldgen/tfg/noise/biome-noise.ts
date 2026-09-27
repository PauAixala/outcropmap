/**
 * Port of `su.terrafirmagreg.core.world.new_ow_wg.noise.TFGBiomeNoise` (TFG Core Modern 0.9.21,
 * commit 2cf74e65), which defines TerraFirmaGreg's own landforms — the ones TFC has no equivalent
 * for: karst towers, glacial cirques, ice sheets and shield volcanoes.
 *
 * Every function here is a **transcription**, not a translation: it uses `NoiseChain`, which mirrors
 * TFC's `Noise2D` interface method for method, so each chain can be read against its Java source
 * line by line. See `./noise-chain.ts` for the two overload traps that makes necessary.
 *
 * Heights are absolute world Y. `SEA_LEVEL_Y` is 63, as in `TFCChunkGenerator`.
 *
 * @unverified No JVM fixture. These are transcribed from source and checked by property — see
 * `tests/unit/tfg-biome-noise.test.ts` and docs/PARITY.md.
 */
import { clamp, clampedMap, lerp, mapRange, type Noise2D } from '@worldgen/tfc-1.20/noise/noise2d';
import { hills as tfcHills } from '@worldgen/tfc-1.20/biome/biome-noise';
import { NoiseChain, chain, rawSimplex, simplex } from './noise-chain';
import {
  addConstant,
  cliffMap,
  clampedScaled,
  maxOf,
  minOf,
  slopedCliffMap,
  stretchZ,
  triangle,
} from './noise-helpers';
import { TFGCellular2D } from './tfg-cellular-2d';

/** `TFCChunkGenerator.SEA_LEVEL_Y`. */
export const SEA_LEVEL_Y = 63;

/**
 * `Mth.map(value, oldMin, oldMax, newMin, newMax)` — an unclamped linear remap. TFG leans on it
 * inside `map(...)` lambdas to build piecewise elevation profiles, so it is worth having by name.
 */
function mthMap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  return newMin + ((value - oldMin) * (newMax - newMin)) / (oldMax - oldMin);
}

// ---------------------------------------------------------------------------------------------
// Flat and near-flat biomes
// ---------------------------------------------------------------------------------------------

/** `TFGBiomeNoise.connectedValleyBaseNoise`: signed valley noise, for asymmetric valley features. */
export function connectedValleyBaseNoise(seed: bigint): NoiseChain {
  return simplex(seed, { spread: 0.0025 });
}

/** `TFGBiomeNoise.connectedValleyNoise`. */
export function connectedValleyNoise(seed: bigint): NoiseChain {
  return connectedValleyBaseNoise(seed).abs();
}

/** `TFGBiomeNoise.flats`: a very flat biome, clamped to a two-block band above sea level. */
export function flats(seed: bigint): NoiseChain {
  return simplex(seed, { octaves: 4, spread: Math.fround(0.03) })
    .scaled(SEA_LEVEL_Y - 12, SEA_LEVEL_Y + 8)
    .clamped(SEA_LEVEL_Y, SEA_LEVEL_Y + 2);
}

/** `TFGBiomeNoise.saltFlats`: just *below* sea level, which is what keeps a salt flat damp. */
export function saltFlats(seed: bigint): NoiseChain {
  return simplex(seed, { octaves: 4, spread: Math.fround(0.05) })
    .scaled(SEA_LEVEL_Y - 16, SEA_LEVEL_Y + 10)
    .clamped(SEA_LEVEL_Y - 2, SEA_LEVEL_Y);
}

/**
 * `TFGBiomeNoise.dunes`.
 *
 * The `map` is transcribed exactly, including the `%` operator. Java's `%` on doubles keeps the
 * sign of the dividend, and so does JavaScript's — they agree here, unlike integer division
 * elsewhere in this project.
 */
export function dunes(seed: bigint, minHeight: number, maxHeight: number): NoiseChain {
  return simplex(seed, { spread: 0.02 })
    .scaled(-3, 3)
    .add((x, z) => x / 6 + 20 * Math.sin(z / 240))
    .map((value) => 1.3 * (Math.abs((value % 5) - 1) * ((value % 5) - (value % 1) > 0 ? 0.5 : 2) - 1))
    .clamped(-1, 1)
    .lazyProduct(simplex(seed, { octaves: 4, spread: 0.1 }).scaled(-1, 2).clamped(0.4, 1))
    .scaled(SEA_LEVEL_Y + minHeight, SEA_LEVEL_Y + maxHeight);
}

// ---------------------------------------------------------------------------------------------
// Shield volcanoes. Each is a piecewise elevation profile over a `hotspot` field, plus a warped
// surface texture. The breakpoints are the caldera geometry and are transcribed verbatim.
// ---------------------------------------------------------------------------------------------

/** The warped surface texture shared, with different output ranges, by every shield volcano. */
function volcanoSurface(
  seed: bigint,
  spread: number,
  outMin: number,
  outMax: number,
  warpSeedOffset: bigint,
  surfaceSeedOffset: bigint,
): NoiseChain {
  const warp = rawSimplex(seed + warpSeedOffset, {
    octaves: 4,
    spread: Math.fround(0.03),
    scaled: [Math.fround(-100), Math.fround(100)],
  });
  return simplex(seed + surfaceSeedOffset, { octaves: 4, spread })
    .warped(warp)
    .map((x) => (x > 0.4 ? x - Math.fround(0.8) : -x))
    .scaled(Math.fround(-0.4), Math.fround(0.8), outMin, outMax);
}

/** `TFGBiomeNoise.activeShieldVolcano`: minimal erosion, recent flows, small caldera. */
export function activeShieldVolcano(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const edgeElev = SEA_LEVEL_Y + 1;
  const calderaEdgeElev = SEA_LEVEL_Y + 115;
  const cliffEdgeElev = SEA_LEVEL_Y + 90;
  const calderaCenterElev = SEA_LEVEL_Y + 60;

  const volcano = hotspot.map((y) =>
    y < 0.75
      ? mthMap(y, 0, 0.75, edgeElev, calderaEdgeElev)
      : y < 0.78
        ? mthMap(y, 0.75, 0.78, calderaEdgeElev, cliffEdgeElev)
        : mthMap(y, 0.78, 1, cliffEdgeElev, calderaCenterElev),
  );

  const flows = lavaFlow(seed).map((y) => (y < 0.45 ? 0 : 1));
  // Note the seed offsets: the warp uses `seed`, the surface `seed + 1`.
  const surface = volcanoSurface(seed, Math.fround(0.06), -8, 8, 0n, 1n);
  return volcano.add(flows).add(surface);
}

/** `TFGBiomeNoise.dormantShieldVolcano`: some erosion, no recent flows, open-sided caldera. */
export function dormantShieldVolcano(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const seaElev = SEA_LEVEL_Y + 9;
  const mtnBaseElev = SEA_LEVEL_Y + 40;
  const calderaEdgeElev = SEA_LEVEL_Y + 70;
  const cliffEdgeElev = SEA_LEVEL_Y + 50;
  const calderaCenterElev = SEA_LEVEL_Y + 15;

  const volcano = hotspot.map((y) =>
    y < 0.45
      ? mthMap(y, 0, 0.45, seaElev, mtnBaseElev)
      : y < 0.72
        ? mthMap(y, 0.45, 0.72, mtnBaseElev, calderaEdgeElev)
        : y < 0.74
          ? mthMap(y, 0.72, 0.74, calderaEdgeElev, cliffEdgeElev)
          : y < 0.85
            ? mthMap(y, 0.74, 0.85, cliffEdgeElev, calderaCenterElev)
            : calderaCenterElev,
  );
  return volcano.add(volcanoSurface(seed, Math.fround(0.02), -48, 32, 43n, 44n));
}

/** `TFGBiomeNoise.glaciatedShieldVolcano`. */
export function glaciatedShieldVolcano(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const seaElev = SEA_LEVEL_Y + 15;
  const mtnBaseElev = SEA_LEVEL_Y + 70;
  const calderaEdgeElev = SEA_LEVEL_Y + 100;
  const cliffEdgeElev = SEA_LEVEL_Y + 60;
  const calderaCenterElev = SEA_LEVEL_Y + 50;

  const volcano = hotspot.map((y) =>
    y < 0.45
      ? mthMap(y, 0, 0.45, seaElev, mtnBaseElev)
      : y < 0.72
        ? mthMap(y, 0.45, 0.72, mtnBaseElev, calderaEdgeElev)
        : y < 0.74
          ? mthMap(y, 0.72, 0.74, calderaEdgeElev, cliffEdgeElev)
          : y < 0.85
            ? mthMap(y, 0.74, 0.85, cliffEdgeElev, calderaCenterElev)
            : calderaCenterElev,
  );
  return volcano.add(volcanoSurface(seed, Math.fround(0.02), -48, 32, 43n, 44n));
}

/** `TFGBiomeNoise.extinctShieldVolcano`: eroded, with the caldera floor below sea level. */
export function extinctShieldVolcano(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const seaElev = SEA_LEVEL_Y + 6;
  const mtnBaseElev = SEA_LEVEL_Y + 25;
  const calderaEdgeElev = SEA_LEVEL_Y + 55;
  const cliffEdgeElev = SEA_LEVEL_Y + 25;
  const calderaCenterElev = SEA_LEVEL_Y - 10;

  const volcano = hotspot.map((y) =>
    y < 0.4
      ? mthMap(y, 0, 0.4, seaElev, mtnBaseElev)
      : y < 0.6
        ? mthMap(y, 0.4, 0.6, mtnBaseElev, calderaEdgeElev)
        : y < 0.62
          ? mthMap(y, 0.6, 0.62, calderaEdgeElev, cliffEdgeElev)
          : y < 0.75
            ? mthMap(y, 0.62, 0.75, cliffEdgeElev, calderaCenterElev)
            : calderaCenterElev,
  );
  return volcano.add(volcanoSurface(seed, Math.fround(0.06), -9, 9, 43n, 44n));
}

/**
 * `TFGBiomeNoise.constant`: a fixed height above sea level.
 *
 * For technical biomes such as shore, where the height the player sees comes from somewhere else
 * but the biome still has to contribute something to the 7x7 blend.
 */
export function constant(height: number): NoiseChain {
  return chain(() => SEA_LEVEL_Y + height);
}

/** `TFGBiomeNoise.sunkenShieldVolcano`: caldera flooded by the ocean. */
export function sunkenShieldVolcano(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const volcano = hotspot.map((y) =>
    y < 0.25
      ? 50
      : y < 0.45
        ? mthMap(y, 0.25, 0.45, 50, SEA_LEVEL_Y)
        : y < 0.6
          ? mthMap(y, 0.45, 0.6, SEA_LEVEL_Y, 95)
          : y < 0.62
            ? mthMap(y, 0.6, 0.62, 94, 80)
            : y < 0.75
              ? mthMap(y, 0.62, 0.75, 80, 52)
              : 52,
  );
  const surface = volcanoSurface(seed, Math.fround(0.06), -6, 6, 43n, 44n);
  const scale = simplex(seed + 789913n, { octaves: 2, spread: Math.fround(0.008) }).scaled(0.45, 1);
  return volcano.lazyProduct(scale).add(surface);
}

/** `TFGBiomeNoise.ancientShieldVolcano`: heavily eroded, cut by valleys. */
export function ancientShieldVolcano(
  seed: bigint,
  minElev: number,
  maxElev: number,
  hotspot: NoiseChain,
): NoiseChain {
  const volcano = hotspot.map((y) =>
    y < 0.15
      ? 90
      : y < 0.6
        ? mthMap(y, 0.15, 0.6, 90, 130)
        : y < 0.63
          ? mthMap(y, 0.6, 0.63, 129, 108)
          : y < 0.7
            ? mthMap(y, 0.63, 0.7, 108, 90)
            : 90,
  );
  const surface = volcanoSurface(seed, Math.fround(0.06), -20, 0, 43n, 44n);
  // `.spread().ridged().octaves()` — `octaves` here is the Noise2D interface wrapper, because
  // `ridged()` has already left the concrete generator behind. And the scale range is inverted
  // (max first), which flips the field; transcribed as written.
  const valleys = simplex(seed + 90183n, { spread: 0.01 }).ridged().octaves(3).scaled(maxElev * 2.2, minElev);
  const scale = simplex(seed + 789913n, { octaves: 2, spread: Math.fround(0.008) }).scaled(0.6, 1);
  return volcano.lazyProduct(scale).min(valleys).add(surface);
}

/** `TFGBiomeNoise.shieldVolcanoIceSheetSurface`: ice over an ice-sheet shield volcano. */
export function shieldVolcanoIceSheetSurface(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const edgeElev = 0;
  const calderaCenterElev = 51;
  return hotspot
    .map((y) => (y < 0.9 ? mthMap(y, 0, 0.9, edgeElev, calderaCenterElev) : calderaCenterElev))
    .add(iceSheetSurfaceHeight(seed));
}

/** `TFGBiomeNoise.shieldVolcanoGlacierSurface`. */
export function shieldVolcanoGlacierSurface(seed: bigint, hotspot: NoiseChain): NoiseChain {
  const base = simplex(seed, { octaves: 3, spread: Math.fround(0.05) }).scaled(-5, 5);
  const lowElev = SEA_LEVEL_Y - 60;
  const edgeElev = SEA_LEVEL_Y + 75;
  const calderaRimElev = SEA_LEVEL_Y + 92;
  const calderaCenterElev = SEA_LEVEL_Y + 98;

  return hotspot
    .map((y) =>
      y < 0.4
        ? lowElev
        : y < 0.58
          ? mthMap(y, 0.4, 0.58, lowElev, edgeElev)
          : y < 0.72
            ? mthMap(y, 0.58, 0.72, edgeElev, calderaRimElev)
            : y < 0.9
              ? mthMap(y, 0.72, 0.9, calderaRimElev, calderaCenterElev)
              : calderaCenterElev,
    )
    .add(base);
}

/**
 * `TFGBiomeNoise.lavaFlow`: `new OpenSimplex2D(seed + 23891L).ridged().spread(0.01)`.
 *
 * Note the order — `ridged()` first, then `spread()`. Because `ridged()` returns the interface, that
 * `spread` is `Noise2D.spread` (which scales the *input coordinates* of an already-ridged field),
 * not `OpenSimplex2D.spread` (which changes the generator's frequency before it is ridged). Ridging
 * then stretching is not the same field as stretching then ridging.
 */
export function lavaFlow(seed: bigint): NoiseChain {
  return simplex(seed + 23891n).ridged().spread(0.01);
}

/** `TFGBiomeNoise.lavaFlowMaterial`: small-scale noise varying the material of a flow. */
export function lavaFlowMaterial(seed: bigint): NoiseChain {
  return simplex(seed, { octaves: 2, spread: 0.25 });
}

/** `TFGBiomeNoise.iceSheetSurfaceHeight` — plain TFC hills, reused. */
export function iceSheetSurfaceHeight(seed: bigint): NoiseChain {
  return chain(tfcHills(seed, 23, 38));
}

// ---------------------------------------------------------------------------------------------
// Arid landforms: sharp hills, badlands, rocky islands
// ---------------------------------------------------------------------------------------------

/**
 * `TFGBiomeNoise.sharpHillsMap`: a piecewise-linear remap that turns an ordinary noise distribution
 * into cliff shapes — the flat runs become plateaus and the steep run becomes the cliff face.
 */
export function sharpHillsMap(input: number): number {
  const in0 = 1.0;
  const in1 = Math.fround(0.67);
  const in2 = Math.fround(0.15);
  const in3 = Math.fround(-0.15);
  const in4 = Math.fround(-0.67);
  const in5 = -1.0;
  const out0 = 1.0;
  const out1 = Math.fround(0.7);
  const out2 = 0.5;
  const out3 = -0.5;
  const out4 = Math.fround(-0.7);
  const out5 = -1.0;

  if (input > in1) return mthMap(input, in1, in0, out1, out0);
  if (input > in2) return mthMap(input, in2, in1, out2, out1);
  if (input > in3) return mthMap(input, in3, in2, out3, out2);
  if (input > in4) return mthMap(input, in4, in3, out4, out3);
  return mthMap(input, in5, in4, out5, out4);
}

/**
 * `TFGBiomeNoise.sharpHills`.
 *
 * Distinct from TFC's own `sharpHills`, which takes no height arguments — this one is TFG's, and
 * the two are not interchangeable.
 */
export function sharpHills(seed: bigint, minHeight: number, maxHeight: number): NoiseChain {
  const base = simplex(seed, { octaves: 4, spread: Math.fround(0.08) });
  const lerpNoise = simplex(seed + 7198234123n, { spread: Math.fround(0.013) })
    .scaled(Math.fround(-0.3), Math.fround(1.6))
    .clamped(0, 1);

  const lerpMapped = chain((x, z) => {
    const value = base.noiseAt(x, z);
    return lerp(lerpNoise.noiseAt(x, z), value, sharpHillsMap(value));
  });

  const variance = simplex(seed + 67981832123n, { octaves: 3, spread: Math.fround(0.06) }).scaled(
    Math.fround(-0.2),
    Math.fround(0.2),
  );

  return lerpMapped
    .add(variance)
    .scaled(Math.fround(-0.75), Math.fround(0.7), SEA_LEVEL_Y - minHeight, SEA_LEVEL_Y + maxHeight);
}

/**
 * `TFGBiomeNoise.badlands`: a flat base cut by terraced canyons.
 *
 * Distinct from TFC's `badlands`, which takes only a seed. The final `map` is a soft floor at sea
 * level: below it the depth is compressed to 30%, so canyons flatten out rather than punching
 * through into the ocean.
 */
export function badlands(seed: bigint, height: number, depth: number): NoiseChain {
  return simplex(seed, { octaves: 4, spread: Math.fround(0.025) })
    .scaled(SEA_LEVEL_Y + height, SEA_LEVEL_Y + height + 10)
    .add(
      simplex(seed + 1n, { octaves: 4, spread: Math.fround(0.04) })
        .ridged()
        .map((x) => Math.fround(1.3) * -(x > 0 ? x * x * x : 0.5 * x))
        .scaled(-1, Math.fround(0.3), -1, 1)
        .terraces(15)
        .scaled(-depth, 0),
    )
    .map((x) => (x < SEA_LEVEL_Y ? SEA_LEVEL_Y - Math.fround(0.3) * (SEA_LEVEL_Y - x) : x));
}

/**
 * `TFGBiomeNoise.rockyIslands`: like mountains, but with the cliffs down near sea level.
 *
 * The cliff layers are sampled only where the base could be affected by them — transcribed as
 * written, because it is not merely an optimisation: it is what keeps cliffs off the sea floor.
 */
export function rockyIslands(seed: bigint): NoiseChain {
  const baseNoise = simplex(seed, { octaves: 4, spread: Math.fround(0.14) }).map((x) => {
    // Power scaled: flattens most of the range and maximises the peaks.
    const x0 = Math.fround(0.125) * (x + 1) * (x + 1) * (x + 1);
    return SEA_LEVEL_Y - 15 + 50 * x0;
  });

  const cliffNoise = simplex(seed + 2n, { octaves: 2, spread: Math.fround(0.01) })
    .scaled(-10, 18)
    .map((x) => (x > 0 ? x : 0));
  const cliffHeightNoise = simplex(seed + 3n, { octaves: 2, spread: Math.fround(0.01) }).scaled(
    SEA_LEVEL_Y - 5,
    SEA_LEVEL_Y + 5,
  );

  return chain((x, z) => {
    let height = baseNoise.noiseAt(x, z);
    if (height > SEA_LEVEL_Y - 10) {
      const cliffHeight = cliffHeightNoise.noiseAt(x, z) - height;
      if (cliffHeight < 0) {
        const mappedCliffHeight = clampedMap(cliffHeight, 0, -1, 0, 1);
        height += mappedCliffHeight * cliffNoise.noiseAt(x, z);
      }
    }
    return height;
  });
}

// ---------------------------------------------------------------------------------------------
// Stepped cliff country: stair canyons, mesas, buttes, hoodoos
//
// All four are the same construction — a canyon base run through `stairStepCliffs` — differing only
// in `valleyWidth`, which widens the valleys without changing their frequency.
// ---------------------------------------------------------------------------------------------

/** `TFGBiomeNoise.canyonBaseNoise`: the aligned-valley base the stepped biomes share. */
export function canyonBaseNoise(
  seed: bigint,
  minHeight: number,
  maxHeight: number,
  valleyWidth: number,
): NoiseChain {
  const valleyEdge = valleyWidth + 0.28;
  return chain(
    clampedScaled(
      simplex(seed + 1n, { octaves: 4, spread: Math.fround(0.03) }).abs().fn,
      valleyWidth,
      valleyEdge,
      minHeight,
      maxHeight,
    ),
  );
}

/**
 * `TFGBiomeNoise.stairStepCliffs`: three stacked bands of cliffs over a base.
 *
 * Each band starts where the one below it ends, which is why `secondCliffStartHeightNoise` is the
 * first start plus *twice* the cliff noise — `doubleCliffNoise` is `cliffNoise.add(cliffNoise)`,
 * the same field added to itself rather than two independent draws.
 */
export function stairStepCliffs(
  seed: bigint,
  input: NoiseChain,
  minCliffStart = 5,
  maxCliffStart = 12,
  cliffHeight = 7,
): NoiseChain {
  const cliffStartHeightNoise = simplex(seed + 3n, {
    octaves: 2,
    spread: Math.fround(0.008),
  }).scaled(SEA_LEVEL_Y + minCliffStart, SEA_LEVEL_Y + maxCliffStart);

  const cliffNoise = simplex(seed + 7n, { spread: Math.fround(0.003) })
    .scaled(-cliffHeight, 2 * cliffHeight)
    .clamped(0, cliffHeight);
  const doubleCliffNoise = cliffNoise.add(cliffNoise);

  const secondCliffStartHeightNoise = cliffStartHeightNoise.add(doubleCliffNoise);
  const secondCliffNoise = simplex(seed + 19n, { spread: Math.fround(0.003) })
    .scaled(-cliffHeight, 2 * cliffHeight)
    .clamped(0, cliffHeight);

  const thirdCliffStartHeightNoise = secondCliffStartHeightNoise.add(doubleCliffNoise);
  const thirdCliffNoise = simplex(seed + 25n, { spread: Math.fround(0.003) })
    .scaled(-cliffHeight, 2 * cliffHeight)
    .clamped(0, cliffHeight);

  const slopeNoise = simplex(seed + 33n, { spread: 0.008 }).scaled(-2, 2);
  // The same slope field is rebuilt for each band in the Java, so it is the same value each time.
  const slope = (): Noise2D => cliffNoise.scaled(0, 7, 3, 6).add(slopeNoise).fn;

  const first = slopedCliffMap(input.fn, cliffStartHeightNoise.fn, cliffNoise.fn, slope());
  const second = slopedCliffMap(
    first,
    secondCliffStartHeightNoise.fn,
    secondCliffNoise.fn,
    slope(),
  );
  return chain(
    slopedCliffMap(second, thirdCliffStartHeightNoise.fn, thirdCliffNoise.fn, slope()),
  );
}

/** The surface texture the three simple stepped biomes share. */
function steppedSurface(seed: bigint, amplitude: number): NoiseChain {
  return simplex(seed, { octaves: 3, spread: 0.08 }).scaled(-amplitude, amplitude);
}

/** `TFGBiomeNoise.stairCanyons`: narrow valleys. */
export function stairCanyons(seed: bigint): NoiseChain {
  return stairStepCliffs(seed, canyonBaseNoise(seed, SEA_LEVEL_Y + 4, SEA_LEVEL_Y + 22, 0.05)).add(
    steppedSurface(seed, 5),
  );
}

/** `TFGBiomeNoise.mesas`: wider valleys, so broader flat tops. */
export function mesas(seed: bigint): NoiseChain {
  return stairStepCliffs(seed, canyonBaseNoise(seed, SEA_LEVEL_Y + 4, SEA_LEVEL_Y + 22, 0.12)).add(
    steppedSurface(seed, 5),
  );
}

/** `TFGBiomeNoise.buttes`: wider still, leaving isolated towers. */
export function buttes(seed: bigint): NoiseChain {
  return stairStepCliffs(seed, canyonBaseNoise(seed, SEA_LEVEL_Y + 4, SEA_LEVEL_Y + 22, 0.18)).add(
    steppedSurface(seed, 5),
  );
}

/**
 * `TFGBiomeNoise.hoodoos`: thin spires, built by taking the *minimum* of a wide base and a spire
 * field, then the maximum of that against a narrow base — so the spires stand where both agree.
 */
export function hoodoos(seed: bigint): NoiseChain {
  const minHeight = SEA_LEVEL_Y + 4;
  const maxHeight = SEA_LEVEL_Y + 22;
  const maxBaseNoise = canyonBaseNoise(seed, minHeight, maxHeight, 0.03);
  const minBaseNoise = canyonBaseNoise(seed, minHeight, maxHeight, 0.2);
  const hoodooNoise = clampedScaled(
    simplex(seed + 1n, { octaves: 3, spread: Math.fround(0.12) }).abs().fn,
    0.2,
    0.6,
    minHeight,
    maxHeight,
  );
  const shape = maxOf(minOf(maxBaseNoise.fn, hoodooNoise), minBaseNoise.fn);
  return stairStepCliffs(seed, chain(shape), 5, 8, 7).add(steppedSurface(seed, 3));
}

// ---------------------------------------------------------------------------------------------
// Karst. These take a base terrain and modify it, so each one's second argument is whatever the
// biome sits on — which is why the extracted expressions nest a TFC noise inside a TFG one.
// ---------------------------------------------------------------------------------------------

/** `TFGBiomeNoise.bowlDolines`: shallow sinkholes, **subtracted** from the base terrain. */
export function bowlDolines(seed: bigint, baseTerrainNoise: NoiseChain, scale: number): NoiseChain {
  const bowls = simplex(seed, { octaves: 3, spread: 0.72 / scale }).map((value) => {
    // A raised cosine gives the bowl its round rim; the 0.1 floor keeps flat ground flat.
    let x = -0.5 * Math.cos(Math.PI * value) + 0.5;
    x = Math.max(x, 0.1) - 0.1;
    return -scale * x;
  });
  return baseTerrainNoise.add(bowls);
}

/** `TFGBiomeNoise.fengcong`: cone karsts, **added** to the base terrain. */
export function fengcong(seed: bigint, baseTerrainNoise: NoiseChain): NoiseChain {
  const scale = 37;
  const cones = simplex(seed, { octaves: 3, spread: 0.06 }).map((value) => {
    let y = -0.5 * Math.cos(Math.PI * Math.abs(value)) + 0.5;
    y = (Math.max(y, 0.25) - 0.25) / 0.75;
    return scale * y;
  });
  return baseTerrainNoise.add(cones);
}

/**
 * `TFGBiomeNoise.fenglinCliffMap`: where `base` exceeds `compare`, lifts it toward 1 by `addend`.
 *
 * Not the same as `TFGNoiseHelpers.cliffMap`, which adds the addend outright. This one interpolates
 * — `base * (1 - addend) + addend` — which is what gives a tower a flat top instead of a spike.
 */
export function fenglinCliffMap(
  baseNoise: NoiseChain,
  compareNoise: NoiseChain,
  addendNoise: NoiseChain,
): NoiseChain {
  return chain((x, z) => {
    const base = baseNoise.noiseAt(x, z);
    if (base > compareNoise.noiseAt(x, z)) {
      const addend = addendNoise.noiseAt(x, z);
      return base * (1 - addend) + addend;
    }
    return base;
  });
}

/** `TFGBiomeNoise.fenglin`: tower karsts. */
export function fenglin(seed: bigint, baseTerrainNoise: NoiseChain, scale: number): NoiseChain {
  const cliffScale = simplex(seed + 78535267n, { spread: 0.06 }).scaled(0, 0.25);
  const cliffStartHeight = simplex(seed + 390798n, { spread: 0.06 }).scaled(0, 0.7);
  const cliffBase = simplex(seed, { octaves: 2, spread: 0.05 }).map((value) => {
    const y = Math.abs(value) - 0.45;
    return y > 0 ? Math.sqrt(y / 0.55) : 0;
  });
  const towers = fenglinCliffMap(cliffBase, cliffStartHeight, cliffScale).map((y) => scale * y);
  return baseTerrainNoise.add(towers);
}

/** `TFGBiomeNoise.cenotes`: deep sinkholes — the same construction as fenglin, negated. */
export function cenotes(
  seed: bigint,
  baseTerrainNoise: NoiseChain,
  vertScale: number,
  horizScale: number,
): NoiseChain {
  const cliffScale = simplex(seed + 78535267n, { spread: 0.72 / horizScale }).scaled(0, 0.4);
  const cliffStartHeight = simplex(seed + 390798n, { spread: 0.72 / horizScale }).scaled(0, 0.7);
  const cliffBase = simplex(seed, { octaves: 2, spread: 0.6 / horizScale }).map((value) => {
    const y = Math.abs(value) - 0.45;
    return y > 0 ? Math.sqrt(y / 0.55) : 0;
  });
  const holes = fenglinCliffMap(cliffBase, cliffStartHeight, cliffScale).map((y) => -vertScale * y);
  return baseTerrainNoise.add(holes);
}

/** `TFGBiomeNoise.burrenCrevices`: the bare fissure field, shared with the surface builder. */
export function burrenCrevices(seed: bigint): NoiseChain {
  return simplex(seed + 398767567n, { octaves: 2, spread: Math.fround(0.08) }).abs();
}

/** `TFGBiomeNoise.burren`: bare limestone pavement cut by crevices. */
export function burren(seed: bigint, baseTerrainNoise: NoiseChain, scale: number): NoiseChain {
  const minHeight = SEA_LEVEL_Y + 2;
  const crevices = burrenCrevices(seed).map((y) =>
    y < 0.15 ? -scale : y < 0.4 ? (y - 0.4) * scale : 0,
  );
  return crevices.add(baseTerrainNoise).map((y) => Math.max(y, minHeight));
}

/** `TFGBiomeNoise.drumlins`: medium hills stretched north-south. */
export function drumlins(seed: bigint): NoiseChain {
  return chain(
    stretchZ(
      simplex(seed, { octaves: 3, spread: Math.fround(0.04) }).scaled(
        SEA_LEVEL_Y - 16,
        SEA_LEVEL_Y + 32,
      ).fn,
      2.5,
    ),
  );
}

/** `TFGBiomeNoise.shilinRidges`: the unscaled stone-forest field, shared with the surface builder. */
export function shilinRidges(seed: bigint): NoiseChain {
  const widthTop = 0.1;
  const widthBot = 0.2;

  // Ridges follow the zeroes of the noise, so taking |y| turns each zero crossing into a wall.
  const ridges = simplex(seed + 398767567n, { octaves: 2, spread: Math.fround(0.06) }).map(
    (value) => {
      const y = Math.abs(value);
      return y < widthTop ? 1 : y < widthBot ? 1 + (0.67 * (y - widthTop)) / (widthTop - widthBot) : 0;
    },
  );

  // Cuts continuous paths through the ridges, so the forest stays walkable.
  const cuts = simplex(seed + 45764379n, { octaves: 2, spread: Math.fround(0.03) }).map((value) => {
    const abs = Math.abs(value);
    const y =
      abs < widthTop * 0.65
        ? 1
        : abs < widthBot * 1.2
          ? 1 + (abs - widthTop * 0.65) / (widthTop * 0.65 - widthBot * 1.2)
          : 0;
    return 1 - y;
  });

  return ridges.lazyProduct(cuts);
}

/** `TFGBiomeNoise.shilin`: stone forest, taking the higher of the towers and the base terrain. */
export function shilin(seed: bigint, baseTerrainNoise: NoiseChain, scale: number): NoiseChain {
  const minHeight = SEA_LEVEL_Y + 2;
  const ridges = shilinRidges(seed);
  const bumps = simplex(seed + 83436545633n, { spread: 0.16 }).scaled(0.6, 1.0);
  return chain(
    maxOf(
      ridges.lazyProduct(bumps).scaled(SEA_LEVEL_Y, SEA_LEVEL_Y + scale).fn,
      baseTerrainNoise.fn,
    ),
  ).map((y) => Math.max(y, minHeight));
}

// ---------------------------------------------------------------------------------------------
// Glacial landforms
// ---------------------------------------------------------------------------------------------

/** `TFGBiomeNoise.knobAndKettle`: hummocky moraine — knobs and hollows over gentle hills. */
export function knobAndKettle(seed: bigint): NoiseChain {
  return simplex(seed, { octaves: 2, spread: Math.fround(0.03) })
    .map((y) => (y > 0.3 ? y - 0.3 : y < -0.3 ? y + 0.3 : 0))
    .scaled(-12, 10)
    .add(tfcHills(seed, -3, 3));
}

/** `TFGBiomeNoise.glacialBase`. */
export function glacialBase(seed: bigint): NoiseChain {
  return chain(addConstant(knobAndKettle(seed).fn, 1.5));
}

/** `TFGBiomeNoise.montaneIceSheetSurfaceHeight` — plain TFC hills. */
export function montaneIceSheetSurfaceHeight(seed: bigint): NoiseChain {
  return chain(tfcHills(seed, 40, 48));
}

/** `TFGBiomeNoise.oceanicIceSheetSurfaceHeight` — plain TFC hills. */
export function oceanicIceSheetSurfaceHeight(seed: bigint): NoiseChain {
  return chain(tfcHills(seed, 18, 26));
}

/** `TFGBiomeNoise.glacialValleyShapeNoise`: the large continuous valleys the cirques sit between. */
export function glacialValleyShapeNoise(seed: bigint): NoiseChain {
  return connectedValleyBaseNoise(seed)
    .map((y) => Math.min(6 * y * y, 0.75 + 0.25 * y))
    .add(simplex(seed + 5287n, { octaves: 4, spread: 0.06 }).scaled(-0.2, 0.2));
}

/** `TFGBiomeNoise.glacialCirquesCliffsScale`. */
export function glacialCirquesCliffsScale(seed: bigint): NoiseChain {
  return simplex(seed + 78267n, { spread: 0.015 })
    .add(glacialValleyShapeNoise(seed))
    .scaled(-10, 8)
    .clamped(0, 7);
}

/** `TFGBiomeNoise.glacialCirquesCliffsStartHeight`. */
export function glacialCirquesCliffsStartHeight(seed: bigint): NoiseChain {
  return connectedValleyNoise(seed)
    .map((y) => (y < 0.43 ? mthMap(y, 0, 0.43, 32, 0) : mthMap(y, 0.43, 1, 0, 32)))
    .add(tfcHills(seed, 18, 26));
}

/** `TFGBiomeNoise.glacialCirquesIceSurfaceHeight`. */
export function glacialCirquesIceSurfaceHeight(seed: bigint): NoiseChain {
  return connectedValleyNoise(seed)
    .map((y) =>
      y < 0.38 ? -100 : y < 0.43 ? mthMap(y, 0.38, 0.43, -50, 0) : mthMap(y, 0.43, 1, 0, 32),
    )
    .add(chain(tfcHills(seed, 15, 23)).add(glacialCirquesCliffsScale(seed)));
}

/**
 * `TFGBiomeNoise.glacialCirques`: the cellular heart of TFG's glaciated mountains.
 *
 * Each cell is either a bowl-shaped cirque or a cone-shaped horn, decided by the valley-shape noise
 * **sampled at the cell's own centre** rather than at the point being drawn. That is what keeps a
 * cell one landform all the way across instead of changing type halfway; note the centre is
 * un-scaled by `cellScale` before sampling, since `cell.cx` is in the cellular field's own space.
 */
export function glacialCirques(seed: bigint): NoiseChain {
  const shape = glacialValleyShapeNoise(seed);
  const shapeMap = connectedValleyNoise(seed);

  const cellScale = 0.01;
  const cells = new TFGCellular2D(seed, 2).spread(cellScale);
  const warp = simplex(seed, { spread: 0.02 }).add(shapeMap).scaled(-1, 2, -0.25, 0.2);
  const roughPeaks = simplex(seed, { octaves: 3, spread: 0.08 }).scaled(0.6, 1.6);

  const cliffScale = simplex(seed + 785267n, { spread: 0.01 }).scaled(-12, 15).clamped(0, 10);
  const cliffStartHeight = chain(addConstant(oceanicIceSheetSurfaceHeight(seed).fn, -8));

  const cirques = chain((x, z) => {
    const cell = cells.cell(x, z);
    const f1 = cell.f1;
    const f2 = cell.f2;
    // `f2 - f1` is 0 at a cell centre and grows toward its edge, so it reads as a radius.
    const f2f1 = f1 > 0 ? f2 - f1 : 1;

    const shapeAtCenter = shapeMap.noiseAt(cell.cx / cellScale, cell.cy / cellScale);

    if (shapeAtCenter > 0.6) {
      // Horn: rises to a rough point.
      let y = f2f1 + warp.noiseAt(x, z);
      const rough = roughPeaks.noiseAt(x, z);
      const scale = Math.min(lerp(2 * y, 1.0, rough), rough);
      y = 1 + scale * y;
      return y;
    }
    // Cirque: a bowl, deepened where it opens toward a valley.
    let y = 1 - (f2f1 - warp.noiseAt(x, z));
    y = 0.5 * (1 + y * y);
    const shapeAtPoint = shapeMap.noiseAt(x, z);
    const valleyCloseness = Math.min(shapeAtPoint - shapeAtCenter, 0);
    return y + clampedMap(f2f1, 0, 0.1, 0, valleyCloseness);
  });

  const body = addConstant(
    cirques.scaled(0, 1, 12, 64).lazyProduct(shape).fn,
    SEA_LEVEL_Y - 15,
  );
  return chain(
    cliffMap(
      cliffMap(body, cliffStartHeight.fn, cliffScale.fn),
      glacialCirquesCliffsStartHeight(seed).fn,
      glacialCirquesCliffsScale(seed).fn,
    ),
  );
}

/** `TFGBiomeNoise.patternedGround`: frost polygons — a dip along every cell border. */
export function patternedGround(seed: bigint): NoiseChain {
  const cells = new TFGCellular2D(seed, Math.fround(0.25), 1).spread(0.05);
  return chain((x, z) => {
    const cell = cells.cell(x, z);
    return cell.f2 - cell.f1 < 0.12 ? -1 : 0;
  });
}

/** `TFGBiomeNoise.invertedPatternedGround`: the same polygons raised, and stepped below sea level. */
export function invertedPatternedGround(seed: bigint): NoiseChain {
  const base = tfcHills(seed, -4, 3);
  const cells = new TFGCellular2D(seed, Math.fround(0.25), 1).spread(0.05);

  return chain((x, z) => {
    const height = base(x, z);
    const cell = cells.cell(x, z);
    const f2f1 = cell.f2 - cell.f1;
    if (height >= SEA_LEVEL_Y) return height + (f2f1 < 0.12 ? 1 : 0);
    return f2f1 < 0.12 ? SEA_LEVEL_Y - 1 : f2f1 < 0.22 ? SEA_LEVEL_Y - 2 : SEA_LEVEL_Y - 3;
  });
}

/** `TFGBiomeNoise.stoneCircles`: a ring raised at a fixed radius from each cell centre. */
export function stoneCircles(seed: bigint): NoiseChain {
  const cells = new TFGCellular2D(seed, Math.fround(0.26), 1).spread(0.09);
  return chain((x, z) => {
    const f1 = cells.cell(x, z).f1;
    return f1 > 0.06 && f1 < 0.13 ? 1 : 0;
  });
}

/**
 * `TFGBiomeNoise.tiankeng`: giant collapse sinkholes.
 *
 * Two `fenglinCliffMap` shapes inlined rather than composed, exactly as the Java does — it shares
 * one evaluation of `compare` and `addend` between both, so composing the two would double the
 * noise calls without changing the result.
 */
export function tiankeng(seed: bigint, baseTerrainNoise: NoiseChain): NoiseChain {
  const cliffScale = simplex(seed + 78535267n, { spread: 0.04 }).scaled(0, 0.04);
  const cliffStartHeight = simplex(seed + 390798n, { spread: 0.04 }).scaled(0, 0.7);

  const wideCliffBase = simplex(seed, { octaves: 2, spread: 0.02 }).map((value) => {
    const y = Math.abs(value) - 0.3;
    return y > 0 ? Math.sqrt(y / 0.7) : 0;
  });
  const deepCliffBase = simplex(seed, { octaves: 2, spread: 0.02 }).map((value) => {
    const y = Math.abs(value) - 0.65;
    return y > 0 ? Math.sqrt(y / 0.35) : 0;
  });

  return chain((x, z) => {
    const compare = cliffStartHeight.noiseAt(x, z);
    const addend = cliffScale.noiseAt(x, z);
    const wideBase = wideCliffBase.noiseAt(x, z);
    const deepBase = deepCliffBase.noiseAt(x, z);
    return (
      baseTerrainNoise.noiseAt(x, z) +
      -22 * (wideBase > compare ? wideBase * (1 - addend) + addend : wideBase) +
      -24 * (deepBase > compare ? deepBase * (1 - addend) + addend : deepBase)
    );
  });
}

/**
 * `TFGBiomeNoise.glacialSurfaceTexture`: crevasse texture, the minimum of two triangle waves.
 *
 * The x/z arguments to the warp are swapped for the second wave. TFG's own comment says that is
 * intentional, so it is transcribed rather than tidied.
 */
export function glacialSurfaceTexture(seed: bigint): NoiseChain {
  const warp = simplex(seed + 413n, { spread: 0.02 }).scaled(-12, 12);
  return chain((x, z) => {
    const yOfX = Math.min(triangle(25, 18, 0.035, x + warp.noiseAt(x, z)), 0.0);
    // Reversed order of x and z in this call is intentional (upstream comment).
    const yOfZ = Math.min(triangle(40, 30, 0.025, z + warp.noiseAt(z, x)), 0.0);
    return Math.min(yOfX, yOfZ);
  });
}

export { chain, clamp, lerp, mapRange, mthMap };
export type { Noise2D };
