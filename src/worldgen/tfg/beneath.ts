/**
 * The Beneath — TerraFirmaGreg's rebuilt Nether.
 *
 * Not a dimension of its own, whatever the name suggests: the Beneath mod (an addon for TFC, by one
 * of TFC's own authors) adds and removes features inside `minecraft:the_nether`, and TerraFirmaGreg
 * replaces that Nether's generator. Its jar ships no `dimension/` json and the save has no folder
 * for it. So this is the Nether, and the map calls it The Beneath because that is what a player
 * calls it.
 *
 * It does **not** use a vanilla noise generator, which is what makes it cheap to port. The pack
 * declares `"generator": { "type": "kubejs_tfc:wrapped", "event_key": "nether" }` and then supplies
 * the whole thing from a KubeJS script — `server_scripts/tfg/worldgen/events.chunks.js`:
 *
 * ```js
 * const BENEATH_ROCK_LAYER_HEIGHT = 38;
 * // every column in the chunk gets the same height
 * emptyNetherHeights[x + 16 * z] = global.NETHER_HEIGHT;   // 208
 *
 * TFCEvents.createChunkDataProvider('nether', event => {
 *   const emptyLayer = TFC.misc.lerpFloatLayer(0, 0, 0, 0);   // no temperature, no rainfall
 *   event.rocks((x, y, z, surfaceY, cache, rockSettings) => {
 *     let skew = y / 6;
 *     return rockSettings.sampleAtLayer(rockLayer.getAt(x + skew, z + skew),
 *       (global.NETHER_HEIGHT - y + depthRockNoise.noise(x + skew, z + skew)) / BENEATH_ROCK_LAYER_HEIGHT);
 *   });
 * });
 * ```
 *
 * Three things follow, and all three are simpler than the overworld:
 *
 * - **The surface is flat at y 208.** Every column, everywhere. There is no height field to port.
 * - **There is no climate.** Temperature and rainfall are a zero layer, so the probe reports zero
 *   rather than a number the game does not have.
 * - **Rock is the whole model**, and it is a lateral layer plus a depth: the layer index counts
 *   downward from 208 in bands of 38 blocks, wobbled by a noise, and both the layer lookup and the
 *   noise are sampled at a position skewed by `y / 6` so the bands lean as they descend.
 *
 * The layer stack is built from the same area machinery as the overworld's rock layer; the source is
 * TFC's `UniformLayer`, `context.random().nextInt()`. The zooms are **fuzzy** — `LayeredArea.zoom`
 * takes "if the zoom should be fuzzy (smooth boundaries)" as its first argument and the script passes
 * `true` at every step. Measurement cannot tell the two apart here (97.85% either way over 9 124
 * blocks, because a uniform-random source rarely puts equal values side by side, which is the only
 * case where they differ), so this follows the script rather than the score.
 *
 * Two of the fourteen rocks the dimension declares, `crackrack` and `basalt`, appear in **no layer**
 * of its own table, so nothing here can ever produce them. `crackrack` shows up in the world near the
 * roof because a feature places it, not the rock layer — 126 blocks of 18 141.
 *
 * **Measured against a real Beneath**, 18 141 raw-rock blocks from 172 columns of Pau's world:
 * **97.8% correct below 120 blocks from the roof**, where nothing decorates, and 90.9% overall. The
 * shallow band is where the Beneath mod's own features replace rock the generator laid — the same
 * class of gap as the overworld's unported soil cap, not an error in this port. See docs/PARITY.md
 * and `tests/parity/beneath-rock.parity.test.ts`.
 */
import { fuzzyZoomArea, smoothArea, uniformSourceArea, type Area } from '../tfc-1.20/biome/area';
import { OpenSimplex2D } from '../tfc-1.20/noise/open-simplex-2d';
import { createRockLayerSampler, type RockLayersJson } from '../tfc-1.20/rock/layer-settings';
import beneathRocks from '@data/tfg/rock-layers-beneath.json';

/** `global.NETHER_HEIGHT` — the flat surface every column of the Beneath sits at. */
export const BENEATH_SURFACE_Y = 208;

/** `BENEATH_ROCK_LAYER_HEIGHT` — how many blocks of depth one rock layer covers. */
const ROCK_LAYER_HEIGHT = 38;

/** The rock stack the pack declares for this dimension: 14 rocks, its own order. */
export const beneathRockSampler = createRockLayerSampler(beneathRocks as unknown as RockLayersJson);

/**
 * The lateral rock layer, with the seeds the script passes — each step names its own, unlike the
 * overworld's rock layer which reuses one throughout.
 */
function buildRockLayer(): Area {
  let area = uniformSourceArea(413567326n);
  for (let i = 0; i < 3; i++) {
    area = fuzzyZoomArea(19763144126n, area);
    area = smoothArea(79784123632n, area);
  }
  for (let i = 0; i < 6; i++) area = fuzzyZoomArea(451364589723n, area);
  area = smoothArea(71214856214n, area);
  area = fuzzyZoomArea(854126548632n, area);
  return smoothArea(145256147896n, area);
}

/**
 * `depthRockNoise`: what makes the bands wobble instead of lying flat.
 * `newOpenSimplex2D(432746324).octaves(2).spread(0.03).scaled(-10, 10)`.
 */
function buildDepthNoise(): (x: number, z: number) => number {
  const noise = new OpenSimplex2D(432746324n).octaves(2).spread(Math.fround(0.03)).scaled(-10, 10);
  return (x, z) => noise.noise(x, z);
}

/**
 * The Beneath, as much of it as exists: a flat roof of rock over a stack of layers.
 *
 * Seedless on purpose. Every noise and every layer in the script above is constructed from a
 * literal, so the Beneath is **the same in every world** — a fact worth stating rather than hiding
 * behind a seed parameter that would do nothing.
 */
export class BeneathGenerator {
  private readonly rockLayer = buildRockLayer();
  private readonly depthNoise = buildDepthNoise();

  /** Flat at 208 everywhere. */
  surfaceY(): number {
    return BENEATH_SURFACE_Y;
  }

  /** The rock at a block position, as a bare id (`blackstone`, `deepslate`). */
  rockAt(x: number, y: number, z: number): string | null {
    // `getAt` takes ints and the script hands it `x + y / 6`; Rhino coerces a double to int by
    // truncating toward zero, which differs from flooring everywhere x or z is negative.
    const skew = y / 6;
    const sx = Math.trunc(x + skew);
    const sz = Math.trunc(z + skew);
    const point = this.rockLayer(sx, sz);
    // The script divides in floating point and lets `sampleAtLayer` take the integer part.
    const layer = Math.trunc(
      (BENEATH_SURFACE_Y - y + this.depthNoise(sx, sz)) / ROCK_LAYER_HEIGHT,
    );
    return beneathRockSampler.sampleAtLayer(point, Math.max(0, layer));
  }

  /** The Beneath has no climate: the script hands the chunk a zero layer for both. */
  climate(): { temperature: number; rainfall: number } {
    return { temperature: 0, rainfall: 0 };
  }
}
