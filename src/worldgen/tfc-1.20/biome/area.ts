/** TFC 1.20.x b158c9c: AreaContext, UniformLayer, ZoomLayer.NORMAL and SmoothLayer.
 * Fixture-verified bit-exact against real compiled TFC source, exercised end-to-end via
 * `uniformArea` (RegionGenerator.biomeArea) and the layer stack in `./layers.ts`
 * (tests/parity/tfc-1.20-biomes.parity.test.ts, tests/fixtures/tfc-1.20/biomes.json). */
import { XoroshiroLimbs, multiplyLong, type RandomSource } from '@core/random';

export type Area = (x: number, z: number) => number;

/** Area cache eviction changes cost only: every source is deterministic by coordinate, so a
 * smaller table only means more recompute on a miss, never a wrong value.
 *
 * `CACHE_SIZE` was `1024` (Java's own per-layer bound) until docs/PLAN.md section 6's profiling
 * found the `rock` layer costing ~40x what `biome` costs per pixel on an already-warm region. The
 * `rock` zoom stack (`../rock/layer.ts`) runs all the way to **block** resolution (unlike `biome`,
 * which stops at quart -- 16 blocks share one quart query, so its finest layer's working set for a
 * tile is 16x smaller to begin with): a 256-block-wide tile needs up to 65,536 distinct keys at
 * the finest layer and 16,384 at the next one up, both far past a 1024-slot direct-mapped table,
 * so most of those levels' entries were evicted before the neighbour-sampling `zoomArea`/
 * `smoothArea` passes (each queries several nearby positions at the *same* level, not just its own
 * pixel) could reuse them -- real thrashing, confirmed by direct measurement rather than assumed:
 * sizing this table up dropped a full-tile `rockAt` sweep's time roughly 25% at every size tried
 * from 2,048 up to 16,384, flattening out by 8,192 (`tools/benchmark-slice1.ts`'s rock section).
 * `8192` is the chosen size -- past it, returns were flat to within measurement noise, so a bigger
 * table would only cost more memory (`Int32Array` x3 + `Uint8Array`, ~57 KiB/layer at this size,
 * times roughly a dozen layers per generator instance) for no further speedup. This is *not* the
 * dominant fix for the `rock` slowness, though -- see `rockStackAtPoint` in
 * `../rock/layer-settings.ts` for the one that mattered far more (a ~2x win here vs. that one's
 * ~170x on the part of `rocks()` this table doesn't touch at all). */
const CACHE_SIZE = 8192;
const CACHE_MASK = CACHE_SIZE - 1;
export function cachedArea(source: Area): Area {
  const keysX = new Int32Array(CACHE_SIZE), keysZ = new Int32Array(CACHE_SIZE), values = new Int32Array(CACHE_SIZE), used = new Uint8Array(CACHE_SIZE);
  return (x, z) => {
    const slot = (Math.imul(x, 501125321) ^ Math.imul(z, 1136930381)) & CACHE_MASK;
    if (used[slot] && keysX[slot] === x && keysZ[slot] === z) return values[slot]!;
    const value = source(x, z);
    keysX[slot] = x; keysZ[slot] = z; values[slot] = value; used[slot] = 1;
    return value;
  };
}

/** fastutil HashCommon.murmurHash3(long), used by AreaContext's constructor. */
function murmurHash3(value: bigint): bigint {
  let x = BigInt.asUintN(64, value);
  x ^= x >> 33n; x = BigInt.asUintN(64, x * 0xff51afd7ed558ccdn);
  x ^= x >> 33n; x = BigInt.asUintN(64, x * 0xc4ceb9fe1a85ec53n);
  return BigInt.asIntN(64, x ^ (x >> 33n));
}

/** AreaContext.setSeed and choose. A separate random per layer prevents recursive parent calls
 * from changing the child's stream.
 *
 * Runs once per quart per layer, which makes it the hottest code in biome generation. The long
 * arithmetic is therefore done on 32-bit limbs (`XoroshiroLimbs`, `multiplyLong`) rather than
 * BigInt: same bits — tests/parity/tfc-1.20-biomes.parity.test.ts still passes unchanged — without
 * allocating on every call. Java: `((long) x * 501125321L ^ (long) z * 1136930381L ^ seed)
 * * 0x27d4eb2dL`, where `(long) x` sign-extends. */
const scratchA = new Uint32Array(2);
const scratchB = new Uint32Array(2);
class AreaContext {
  private readonly random = new XoroshiroLimbs();
  private readonly seedHi: number;
  private readonly seedLo: number;
  constructor(seed: bigint) {
    const mixed = BigInt.asUintN(64, murmurHash3(seed));
    this.seedHi = Number(mixed >> 32n);
    this.seedLo = Number(mixed & 0xffffffffn);
  }
  private pendingX = 0;
  private pendingZ = 0;
  private seeded = true;

  /**
   * Records the position; the reseed itself happens only if a draw follows (`draw`). Exact, not an
   * approximation: every draw in this file is preceded by its own `setSeed`, so a reseed that no
   * draw consumes is overwritten before anything can observe it. Most calls on a uniform area are
   * exactly that — a zoom on an even position, or a smooth whose tie is between equal values — and
   * the reseed (three 64-bit multiplies and two Stafford mixes) was the single largest cost left in
   * a relief tile.
   */
  setSeed(x: number, z: number): void {
    this.pendingX = x;
    this.pendingZ = z;
    this.seeded = false;
  }

  /** The random, seeded for the last `setSeed` position. Every draw goes through here. */
  draw(): XoroshiroLimbs {
    if (!this.seeded) {
      this.seeded = true;
      this.reseed(this.pendingX, this.pendingZ);
    }
    return this.random;
  }

  private reseed(x: number, z: number): void {
    multiplyLong(x >> 31, x >>> 0, 0, 501125321, scratchA);
    multiplyLong(z >> 31, z >>> 0, 0, 1136930381, scratchB);
    multiplyLong(
      scratchA[0]! ^ scratchB[0]! ^ this.seedHi,
      scratchA[1]! ^ scratchB[1]! ^ this.seedLo,
      0,
      0x27d4eb2d,
      scratchA,
    );
    this.random.setSeed(scratchA[0]!, scratchA[1]!);
  }
  /** `AreaContext.choose`. Between equal values the draw cannot change the answer, and the state
   * it would have advanced is reseeded before its next use, so it is skipped. */
  choose(a: number, b: number): number { return a === b ? a : this.draw().nextBoolean() ? a : b; }
}

export function uniformArea(random: RandomSource, zoomLevels: number): Area {
  const ctx = new AreaContext(random.nextLong());
  let area = cachedArea((x, z) => { ctx.setSeed(x, z); return ctx.draw().nextInt(); });
  for (let i = 0; i < zoomLevels; i++) {
    area = zoomArea(random.nextLong(), area);
    area = smoothArea(random.nextLong(), area);
  }
  return area;
}

export function zoomArea(seed: bigint, parent: Area): Area {
  const ctx = new AreaContext(seed);
  return cachedArea((x, z) => {
    const px = x >> 1, pz = z >> 1, a = parent(px, pz);
    ctx.setSeed(px, pz);
    if ((x & 1) === 0 && (z & 1) === 0) return a;
    if ((x & 1) === 0) return ctx.choose(a, parent(px, pz + 1));
    if ((z & 1) === 0) return ctx.choose(a, parent(px + 1, pz));
    const b = parent(px, pz + 1), c = parent(px + 1, pz), d = parent(px + 1, pz + 1);
    if (a === b) return a === c || c !== d ? a : ctx.choose(a, c);
    if (a === c) return b !== d ? a : ctx.choose(a, b);
    if (a === d) return b !== c ? a : ctx.choose(a, b);
    if (b === c || b === d) return b;
    if (c === d) return c;
    const pick = ctx.draw().nextIntBounded(4);
    return pick === 0 ? a : pick === 1 ? b : pick === 2 ? c : d;
  });
}

/**
 * `ZoomLayer.FUZZY`. The two-way cases are identical to `NORMAL`; where four parents meet it simply
 * picks one at random instead of taking the majority.
 *
 * `kubejs_tfc`'s `LayeredArea.zoom(fuzzy, seed)` takes that as its first argument — "If the zoom
 * should be fuzzy (smooth boundaries)" — and TerraFirmaGreg's Beneath passes `true` at every step.
 */
export function fuzzyZoomArea(seed: bigint, parent: Area): Area {
  const ctx = new AreaContext(seed);
  return cachedArea((x, z) => {
    const px = x >> 1, pz = z >> 1, a = parent(px, pz);
    ctx.setSeed(px, pz);
    if ((x & 1) === 0 && (z & 1) === 0) return a;
    if ((x & 1) === 0) return ctx.choose(a, parent(px, pz + 1));
    if ((z & 1) === 0) return ctx.choose(a, parent(px + 1, pz));
    const b = parent(px, pz + 1), c = parent(px + 1, pz), d = parent(px + 1, pz + 1);
    const pick = ctx.draw().nextIntBounded(4);
    return pick === 0 ? a : pick === 1 ? b : pick === 2 ? c : d;
  });
}

export function smoothArea(seed: bigint, parent: Area): Area {
  const ctx = new AreaContext(seed);
  return cachedArea((x, z) => {
    ctx.setSeed(x, z);
    const north = parent(x, z - 1), east = parent(x + 1, z), south = parent(x, z + 1), west = parent(x - 1, z), center = parent(x, z);
    const equalX = east === west, equalZ = north === south;
    // SmoothLayer names its 2nd argument west and 4th east; AdjacentTransformLayer passes
    // physical east then west. Preserve choose(physical west, north) for seeded ties.
    return equalX === equalZ ? equalX ? ctx.choose(west, north) : center : equalX ? west : north;
  });
}

/**
 * TFC `SourceLayer`: a fresh value per position from the layer's own context, reseeded at (x, z).
 * `fn` receives a draw function; drawing seeds the context lazily, exactly as `AreaContext` does.
 */
export function sourceArea(seed: bigint, fn: (x: number, z: number, nextInt: (bound: number) => number) => number): Area {
  const ctx = new AreaContext(seed);
  const nextInt = (bound: number): number => ctx.draw().nextIntBounded(bound);
  return cachedArea((x, z) => {
    ctx.setSeed(x, z);
    return fn(x, z, nextInt);
  });
}

/**
 * TFC `UniformLayer`: `context.random().nextInt()` at every position, unbounded.
 *
 * The starting point of a layer stack that has no parent to transform — TerraFirmaGreg builds The
 * Beneath's rock layer from one (`kubejs_tfc`'s `TFC.misc.uniformLayeredArea`).
 */
export function uniformSourceArea(seed: bigint): Area {
  const ctx = new AreaContext(seed);
  return cachedArea((x, z) => {
    ctx.setSeed(x, z);
    return ctx.draw().nextInt();
  });
}

/** TFC `CenterTransformLayer`: maps the parent's value at the same position, reseeded at (x, z). */
export function centerTransformArea(
  seed: bigint,
  parent: Area,
  fn: (value: number, nextInt: (bound: number) => number) => number,
): Area {
  const ctx = new AreaContext(seed);
  const nextInt = (bound: number): number => ctx.draw().nextIntBounded(bound);
  return cachedArea((x, z) => {
    ctx.setSeed(x, z);
    return fn(parent(x, z), nextInt);
  });
}

/**
 * TFC `AdjacentTransformLayer`: north, east, south, west and centre of the parent. Physical order,
 * as `AdjacentTransformLayer.apply` passes them (north is -z, east is +x).
 */
export function adjacentTransformArea(
  // Unused: `AdjacentTransformLayer` draws nothing, but TFC still consumes a seed for the layer, and
  // taking it keeps call sites in the same step-by-step order as `TFCLayers`.
  _seed: bigint,
  parent: Area,
  fn: (north: number, east: number, south: number, west: number, center: number) => number,
): Area {
  return cachedArea((x, z) => fn(parent(x, z - 1), parent(x + 1, z), parent(x, z + 1), parent(x - 1, z), parent(x, z)));
}
