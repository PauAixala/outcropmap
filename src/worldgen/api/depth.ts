/**
 * Depth below the surface for a deposit, and dropping the deposits that generate nothing at all
 * (docs/PLAN.md section 10).
 *
 * Runs once per region at feature-generation time and the results are stored on the features, never
 * recomputed per frame or per filter change (CLAUDE.md section 5).
 *
 * ## Why a deposit can be a phantom
 *
 * `VeinFeature.place` writes a block only where `getStateToGenerate` finds a replaceable **raw
 * rock** already in the world. Above the surface there is air, so nothing is placed. TFC's veins are
 * configured over wide Y bands that often run far above the terrain — the shallow `surface_*` veins
 * especially — so the game rolls a vein there and generates no ore whatsoever.
 *
 * Measured on seed 0 over a 512x512 box: **473 of 1 605 TFC deposits sit entirely above the surface**
 * at their centre column. Drawing a marker for each is the confidently-wrong failure CLAUDE.md
 * section 1a rules out, so a deposit proven to place nothing is dropped here.
 *
 * **"Proven" is doing real work in that sentence.** A deposit spans a footprint, not a column, and
 * the surface varies across it; the game only needs *one* column high enough. So the test is against
 * the **maximum** surface height over the footprint, never the centre. Testing the centre alone
 * would drop about a hundred deposits that do generate ore — hiding real ore, which is the worse
 * error of the two.
 *
 * ## Why a shared grid rather than sampling each footprint
 *
 * `surfaceY` is dominated by its per-chunk biome-weight blend: a cold chunk costs ~0.55 ms and
 * further columns inside that chunk about 0.02 ms. Sampling each deposit's footprint separately
 * walks chunks in scattered order and pays the cold cost repeatedly — measured at 6-12 s per region.
 * Walking the region **chunk-major** once and sampling a coarse grid pays each chunk exactly once:
 * 16 384 samples in 965 ms, which is *cheaper* than one scattered sample per deposit (~2 s) and
 * serves every deposit at a far finer resolution than a per-footprint grid could afford.
 *
 * The grid is coarse, so it can under-estimate a peak between samples. Two things bound that: the
 * drop count is insensitive to resolution (a 3x3 per-footprint grid finds 379 drops, a 9x9 finds
 * 371), and the footprint window is widened by one grid cell on every side, which biases the maximum
 * upward and therefore biases the decision toward **keeping** a marker.
 *
 * ## What is still not answered
 *
 * `exposure` stays `'unknown'` on every surviving deposit. Surface height gives the depth, not the
 * visibility: TFC caps every column with soil whose depth comes from
 * `SurfaceBuilderContext.calculateAltitudeSlopeSurfaceDepth` (altitude, neighbouring slope, and a
 * per-biome surface builder — none ported), and cave exposure needs the carvers. A wrong `surface`
 * sends someone on a long walk for nothing. See docs/PARITY.md.
 */
import type { BlockBox, DepositFeature, IndicatorReach, VeinIndicator } from './types';

/** Blocks between grid samples. 4 costs ~965 ms per 512x512 region; see the header. */
const GRID_STEP = 4;

/**
 * Spacing of the first pass. Its nodes are every other node of `GRID_STEP`, hence a subset of them,
 * so a coarse maximum can only understate the fine one — which is what makes the two-pass resolve in
 * `resolveDepositDepth` exact rather than an approximation.
 */
const COARSE_STEP = 8;

/** Fallback footprint radius for a vein that reports neither `size` nor `blocksAcross`. */
const DEFAULT_RADIUS = 8;

/** How far a deposit's footprint can reach outside the box, so the grid still covers it. */
const BOX_MARGIN = 64;

/**
 * Whether an above-ground indicator — the small ore chunks that let a player find a vein by walking
 * rather than digging blind — can spawn over a deposit whose top sits `depthBelowSurface` down.
 *
 * `VeinFeature.place` gates it on `Math.abs(indicatorY - maxVeinY) < indicator.depth()`, where
 * `maxVeinY` is the highest position an ore block was **actually placed** — block-by-block
 * generation this project does not do. So the exact position of an indicator is out of reach, but
 * one side of the test is not, and it is the side a player cares about: `maxVeinY` can never exceed
 * the vein's own top, so once the surface is `depth` or more above that top, no above-ground
 * indicator can spawn at all. That is a certainty.
 *
 * `'possible'` is the weaker claim it looks like: the geometry allows one, while the rarity roll and
 * the ore actually generating here still stand in the way. `rarity === 0` short-circuits the branch
 * in Java, so those veins get underground indicators only.
 */
export function indicatorReachFor(
  indicator: VeinIndicator | null,
  depthBelowSurface: number | null,
): IndicatorReach {
  if (indicator === null || indicator.rarity === 0) return 'none';
  if (depthBelowSurface === null) return 'unknown';
  return depthBelowSurface >= indicator.depth ? 'too-deep' : 'possible';
}

/** The deposit's footprint radius in blocks, from whichever field its port reports. */
function footprintRadius(deposit: DepositFeature): number {
  if (deposit.blocksAcross !== undefined) return Math.ceil(deposit.blocksAcross / 2);
  if (deposit.size !== undefined) return deposit.size;
  return DEFAULT_RADIUS;
}

/**
 * A coarse maximum-height lookup over one region, sampled only where it will be read.
 *
 * Every deposit asks `maxAround` for the lattice nodes within its footprint (plus one cell). This
 * samples exactly the union of those windows — nothing else — so the answer for each deposit is
 * identical to sampling the whole region, at a cost that scales with the deposits instead of the
 * area. A full region was ~26 000 `surfaceY` calls whether it held 460 deposits or 5; filtering the
 * map to one ore now pays only for that ore's footprints.
 *
 * Sampling runs chunk-major, and the exact deposit centres are resolved inside the same pass, so
 * each chunk's biome weights are computed once while they are still cached.
 */
class MaxHeightGrid {
  private readonly heights: Int32Array;
  private readonly sampled: Uint8Array;
  private readonly columns: number;
  private readonly rows: number;
  private readonly step: number;

  constructor(
    private readonly minX: number,
    private readonly minZ: number,
    maxX: number,
    maxZ: number,
    windows: readonly (readonly [number, number, number])[],
    exactColumns: readonly (readonly [number, number])[],
    exactHeights: Int32Array,
    surfaceY: (x: number, z: number) => number,
    step: number = GRID_STEP,
    /** How far outside a footprint to look, in blocks. Fixed rather than tied to `step`, so a
     * coarse grid searches the same area a fine one does and their maxima stay comparable. */
    private readonly widen: number = GRID_STEP,
  ) {
    this.step = step;
    this.columns = Math.floor((maxX - minX) / step) + 1;
    this.rows = Math.floor((maxZ - minZ) / step) + 1;
    this.heights = new Int32Array(this.columns * this.rows);
    this.sampled = new Uint8Array(this.columns * this.rows);

    // Which nodes any deposit window covers, bucketed by the chunk they fall in.
    const byChunk = new Map<number, number[]>();
    const chunkKey = (x: number, z: number): number => Math.floor(x / 16) * 65536 + Math.floor(z / 16);
    const wanted = new Uint8Array(this.columns * this.rows);
    for (const [x, z, radius] of windows) {
      const { firstColumn, lastColumn, firstRow, lastRow } = this.window(x, z, radius);
      for (let row = firstRow; row <= lastRow; row++) {
        for (let column = firstColumn; column <= lastColumn; column++) {
          const node = row * this.columns + column;
          if (wanted[node]) continue;
          wanted[node] = 1;
          const key = chunkKey(minX + column * step, minZ + row * step);
          const bucket = byChunk.get(key);
          if (bucket) bucket.push(node);
          else byChunk.set(key, [node]);
        }
      }
    }
    const exactByChunk = new Map<number, number[]>();
    exactColumns.forEach(([x, z], index) => {
      const key = chunkKey(x, z);
      const bucket = exactByChunk.get(key);
      if (bucket) bucket.push(index);
      else exactByChunk.set(key, [index]);
      if (!byChunk.has(key)) byChunk.set(key, []);
    });

    // Chunk-major order, as before: neighbouring chunks share biome weight work.
    const keys = [...byChunk.keys()].sort((a, b) => {
      const ax = Math.floor(a / 65536);
      const bx = Math.floor(b / 65536);
      const az = a - ax * 65536;
      const bz = b - bx * 65536;
      return az - bz || ax - bx;
    });
    for (const key of keys) {
      for (const node of byChunk.get(key) ?? []) {
        const column = node % this.columns;
        const row = (node - column) / this.columns;
        this.heights[node] = surfaceY(minX + column * step, minZ + row * step);
        this.sampled[node] = 1;
      }
      for (const index of exactByChunk.get(key) ?? []) {
        const column = exactColumns[index];
        if (column) exactHeights[index] = surfaceY(column[0], column[1]);
      }
    }
  }

  private window(x: number, z: number, radius: number) {
    const reach = radius + this.widen;
    return {
      firstColumn: Math.max(0, Math.ceil((x - reach - this.minX) / this.step)),
      lastColumn: Math.min(this.columns - 1, Math.floor((x + reach - this.minX) / this.step)),
      firstRow: Math.max(0, Math.ceil((z - reach - this.minZ) / this.step)),
      lastRow: Math.min(this.rows - 1, Math.floor((z + reach - this.minZ) / this.step)),
    };
  }

  /**
   * The highest sampled surface within `radius` of `(x, z)`, widened by one grid cell on each side
   * so a peak falling between samples still counts. `null` when the window is entirely off-grid.
   */
  maxAround(x: number, z: number, radius: number): number | null {
    const { firstColumn, lastColumn, firstRow, lastRow } = this.window(x, z, radius);
    let best: number | null = null;
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const node = row * this.columns + column;
        if (!this.sampled[node]) continue;
        const height = this.heights[node]!;
        if (best === null || height > best) best = height;
      }
    }
    return best;
  }
}

/**
 * Fills `surfaceY` and `depthBelowSurface` on each deposit, and drops the ones whose whole Y range
 * sits above the highest ground anywhere in their footprint — those place no blocks at all.
 *
 * `surfaceY` returning `null` — a profile whose height field is not ported, such as `tfg` — leaves
 * every deposit untouched, per the `DepositFeature` contract: never a guessed value, and never a
 * deposit dropped on the strength of a height we do not have.
 */
export function resolveDepositDepth(
  deposits: readonly DepositFeature[],
  box: BlockBox,
  surfaceY: (x: number, z: number) => number | null,
  /** Spacing of the first pass. Only a benchmark passes anything but the default; passing
   * `GRID_STEP` makes both passes identical, i.e. the single-pass behaviour this replaced. */
  coarseStep: number = COARSE_STEP,
): DepositFeature[] {
  if (deposits.length === 0) return [];
  if (surfaceY(box.minX, box.minZ) === null) return [...deposits];

  const centres = deposits.map((deposit) => [deposit.x, deposit.z] as const);
  const centreHeights = new Int32Array(deposits.length);
  // The null case is ruled out above: a profile either has a height field or it does not.
  const height = (x: number, z: number): number => surfaceY(x, z) ?? 0;
  const windows = deposits.map(
    (deposit) => [deposit.x, deposit.z, footprintRadius(deposit)] as const,
  );

  /**
   * Two passes, and the result is **identical** to sampling everything at `GRID_STEP`.
   *
   * The coarse pass samples every other node, which is a subset of the fine grid's, over the same
   * search area — so `coarseMax <= fineMax`, and any deposit the coarse pass already accepts the
   * fine pass would accept too. Only the rejects are ambiguous, and they are the minority, so the
   * fine grid is built over their footprints alone. Sampling the surface is what this costs
   * (~24 000 columns per region before, most of them on deposits that were never in doubt).
   */
  const coarse = new MaxHeightGrid(
    box.minX - BOX_MARGIN,
    box.minZ - BOX_MARGIN,
    box.maxX + BOX_MARGIN,
    box.maxZ + BOX_MARGIN,
    windows,
    centres,
    centreHeights,
    height,
    coarseStep,
    GRID_STEP,
  );

  const undecided: number[] = [];
  deposits.forEach((deposit, index) => {
    const highest = coarse.maxAround(deposit.x, deposit.z, footprintRadius(deposit));
    if (highest !== null && deposit.bottomY > highest) undecided.push(index);
  });
  const fine =
    undecided.length === 0 || coarseStep === GRID_STEP
      ? null
      : new MaxHeightGrid(
          box.minX - BOX_MARGIN,
          box.minZ - BOX_MARGIN,
          box.maxX + BOX_MARGIN,
          box.maxZ + BOX_MARGIN,
          undecided.map((index) => windows[index]!),
          [],
          new Int32Array(0),
          height,
          GRID_STEP,
          GRID_STEP,
        );
  const undecidedSet = new Set(undecided);

  const resolved: DepositFeature[] = [];
  deposits.forEach((deposit, index) => {
    const grid = fine !== null && undecidedSet.has(index) ? fine : coarse;
    const highest = grid.maxAround(deposit.x, deposit.z, footprintRadius(deposit));
    // No ground anywhere in the footprint reaches the bottom of the vein, so the game places
    // nothing here and there is nothing to walk to.
    if (highest !== null && deposit.bottomY > highest) return;
    const centre = centreHeights[index] ?? 0;
    const depthBelowSurface = centre - deposit.topY;
    resolved.push({
      ...deposit,
      surfaceY: centre,
      depthBelowSurface,
      // Answers "can I find this by walking?" as far as it can be answered honestly.
      indicatorReach: indicatorReachFor(deposit.indicator, depthBelowSurface),
    });
  });
  return resolved;
}
