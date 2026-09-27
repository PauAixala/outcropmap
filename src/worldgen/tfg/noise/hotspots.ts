/** TFG Core Modern 0.9.21 TFGBiomeNoise hotspot fields. EUPL-1.2. */
import { OpenSimplex2D } from '../../tfc-1.20/noise/open-simplex-2d';
import { TFGCellular2D } from './tfg-cellular-2d';

export function hotspotFields(seed: bigint) {
  const simplex = new OpenSimplex2D(seed);
  const plates = new TFGCellular2D(seed).spread(Math.fround(Math.fround(0.00590625) / 96));
  function active(x: number, z: number): number {
    let value = 0;
    // map() returns generic Noise2D: these are its octaves, not OpenSimplex's FBm.
    for (let i = 0; i < 3; i++) {
      const y = simplex.noise((x * 0.003) / (1 << i), (z * 0.003) / (1 << i));
      value += (y > 0.75 ? y - 0.75 : 0) * 7.2 * Math.pow(0.5, 3 - i);
    }
    return value;
  }
  // `ux` is the plate cell's noise at (x, z). All three warps below sample the same position, so
  // `valuesAtBlock` evaluates the cell once and hands it in — same inputs, same float, a third of
  // the cellular searches.
  function warp(x: number, z: number, ux: number, velocity: number, acceleration: number): number {
    const uz = ((Math.abs(ux * 16) % 1 > 0.5 ? 1 : -1) * (ux * 256)) % 1;
    const vx = (ux + (ux > 0 ? 1 : -1)) * velocity;
    const vz = (uz + (uz > 0 ? 1 : -1)) * velocity;
    return active(x + vx - vz * acceleration, z + vz + vx * acceleration);
  }
  /**
   * The four hotspot age fields at **block** coordinates.
   *
   * `TFGBiomes` samples `hotSpotIntensity` as an ordinary `Noise2D`, which is per block, while the
   * region tasks work in grid units. Splitting the two apart is the whole point of this pair: the
   * grid version below is `valuesAtBlock` with the 1 grid = 128 blocks conversion applied, and
   * getting that conversion the wrong way round would put every volcano 128x too far out.
   */
  function valuesAtBlock(x: number, z: number): number[] {
    const ux = plates.cell(x, z).noise;
    return [
      active(x, z),
      Math.max(warp(x, z, ux, 1024, 0) - 0.1, 0) * 1.111,
      Math.max(warp(x, z, ux, 2048, 0.25) - 0.2, 0) * 1.25,
      Math.max(warp(x, z, ux, 3072, 0.5) - 0.3, 0) * 1.4286,
    ];
  }
  /** The same four fields at **grid** coordinates, for the region tasks. 1 grid = 128 blocks. */
  function values(x: number, z: number): number[] {
    return valuesAtBlock(x * 128, z * 128);
  }

  const ageOf = (v: number[]): number => {
    const max = Math.max(...v);
    return max <= -0.8 || v.filter((n) => n === max).length !== 1 ? 0 : v.indexOf(max) + 1;
  };

  return {
    /** The four grid-coordinate fields at once, for callers that need both intensity and age. */
    values,
    ageOf,
    plates: new TFGCellular2D(seed).spread(Math.fround(Math.fround(0.00590625) / 96)).spread(128),
    intensity: (x: number, z: number): number => Math.max(...values(x, z)),
    age: (x: number, z: number): number => ageOf(values(x, z)),
    /** `TFGBiomeNoise.hotSpotIntensity` as `TFGBiomes` uses it: per block. */
    intensityAtBlock: (x: number, z: number): number => Math.max(...valuesAtBlock(x, z)),
    /**
     * The four age fields on their own, per block — `activeHotSpots`, `dormantHotSpots`,
     * `extinctHotSpots`, `ancientHotSpots` in TFG's order.
     *
     * Individual volcano biomes take one of these rather than the combined intensity, which is how
     * an active volcano and an extinct one end up in different places along the same chain.
     */
    ageFieldAtBlock:
      (index: number) =>
      (x: number, z: number): number =>
        valuesAtBlock(x, z)[index] ?? 0,
    /** `TFGBiomeNoise.hotSpotAge`, per block. */
    ageAtBlock: (x: number, z: number): number => ageOf(valuesAtBlock(x, z)),
  };
}
