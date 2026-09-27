/**
 * `net.dries007.tfc.world.settings.RockLayerSettings`: the datapack-defined tree of rock choices
 * `ChooseRocks`'s per-position category+seed value (`Region.Point.rock`) samples into, at
 * successively deeper "layers". Built from `src/data/tfc-1.20/rocks.json`'s `rockLayers` field —
 * extracted from `data/tfc/worldgen/world_preset/overworld.json`'s real `rock_layer_settings` by
 * `tools/extract-datapack.mjs` (see its comment there for why each layer's rock choices are stored
 * as an ordered `[rockId, parentLayerId]` array rather than a plain object: order determines which
 * `RandomSource.nextInt(size)` draw picks which rock, so `writeJson`'s alphabetical key sorting
 * must not be allowed to touch it).
 *
 * `ChooseRocks.TYPE_BITS`/`TYPE_MASK`/`OCEAN`/`VOLCANIC`/`LAND`/`UPLIFT` are mirrored here (not
 * imported from `../biome/choose.ts`, which keeps them as unexported local numbers) — see that
 * file's `chooseRocks` for where a `Region.Point.rock` value is actually assembled.
 *
 * `sampleAtLayer` is fixture-verified bit-exact against the real, unmodified `RockLayerSettings`
 * class run on a real JDK -- `RockLayerSettings.Data` built directly from this same extracted
 * `rockLayers` JSON, bypassing its Codec entirely, the same way the biome capture bypasses
 * `Settings`' codec. See tests/parity/tfc-1.20-rocks.parity.test.ts,
 * tests/fixtures/tfc-1.20/rocks.json and tools/parity/capture-tfc-rocks.mjs.
 */
import { XoroshiroRandomSource } from '@core/random';
import rocksData from '@data/tfc-1.20/rocks.json';
import type { RockStack } from '../../api/types';

const TYPE_BITS = 2;
const TYPE_MASK = (1 << TYPE_BITS) - 1;
const OCEAN = 0;
const VOLCANIC = 1;
const LAND = 2;
// UPLIFT = 3, the `default` arm of every `switch` below.

/** `RockLayerSettings.Layer(RockSettings rock, List<Layer> next)` — `next` is a shared array
 * reference (identity, not value, matters: `bottom`'s own entries all share `next === bottom`,
 * a genuine self-reference the real Java also builds — see `buildLayer` below). */
interface Layer {
  readonly rockId: string;
  readonly next: readonly Layer[];
}

interface RockLayerEntry {
  readonly id: string;
  readonly entries: ReadonlyArray<readonly [string, string]>;
}

export interface RockLayersJson {
  readonly bottom: readonly string[];
  readonly layers: readonly RockLayerEntry[];
  readonly oceanFloor: readonly string[];
  readonly land: readonly string[];
  readonly volcanic: readonly string[];
  readonly uplift: readonly string[];
}

export function createRockLayerSampler(data: RockLayersJson) {
  /** `RockLayerSettings.processData`'s `bottom`/`layers` construction: bakes every named layer id
   * into a `Layer[]`, `bottom`'s entries pointing back at `bottom` itself (the tree's one cycle). */
  function buildNamedLayers(): ReadonlyMap<string, readonly Layer[]> {
    const named = new Map<string, readonly Layer[]>();

    const bottom: Layer[] = [];
    named.set('bottom', bottom);
    for (const rockId of data.bottom) {
      bottom.push({ rockId, next: bottom });
    }

    for (const layer of data.layers) {
      if (named.has(layer.id)) {
        throw new Error(`RockLayerSettings: duplicate layer id "${layer.id}"`);
      }
      const baked: Layer[] = [];
      for (const [rockId, parentId] of layer.entries) {
        const next = named.get(parentId);
        if (!next) {
          throw new Error(
            `RockLayerSettings: layer "${layer.id}" references unknown layer "${parentId}"`,
          );
        }
        baked.push({ rockId, next });
      }
      named.set(layer.id, baked);
    }

    return named;
  }

  const NAMED_LAYERS = buildNamedLayers();

  /** `RockLayerSettings.processTopLevel`: concatenates the named layers a top-level category (e.g.
   * `land`) lists into one flat root `Layer[]`. */
  function flatten(ids: readonly string[]): readonly Layer[] {
    const baked: Layer[] = [];
    for (const id of ids) {
      const layer = NAMED_LAYERS.get(id);
      if (!layer) {
        throw new Error(`RockLayerSettings: no layer with id "${id}"`);
      }
      baked.push(...layer);
    }
    return baked;
  }

  const ROOT_LAYERS: readonly [
    readonly Layer[],
    readonly Layer[],
    readonly Layer[],
    readonly Layer[],
  ] = [
    flatten(data.oceanFloor), // OCEAN
    flatten(data.volcanic), // VOLCANIC
    flatten(data.land), // LAND
    flatten(data.uplift), // UPLIFT (default)
  ];

  const BOTTOM_LIST = NAMED_LAYERS.get('bottom');
  if (!BOTTOM_LIST) {
    throw new Error('RockLayerSettings: rocks.json is missing the "bottom" rock layer');
  }

  /**
   * How many more hops (`RockLayerSettings.sampleAtLayer`'s `layerN`) are needed, from a freshly
   * root-picked `Layer`, to *guarantee* — for every possible sequence of random picks along the way,
   * not just a typical one — that the result is drawn from the `bottom` list. This is a real,
   * computed property of the datapack's own tree (memoised, cycle-safe since `bottom` is the only
   * cycle and is the base case), not a guessed depth: see `docs/WORLDGEN-NOTES.md`'s "Rock layers"
   * section for the by-hand trace this was checked against (2/3/3/4 for ocean/volcanic/land/uplift).
   */
  function depthToBottom(entry: Layer, memo: Map<Layer, number>): number {
    if (entry.next === BOTTOM_LIST) return 1;
    const cached = memo.get(entry);
    if (cached !== undefined) return cached;
    memo.set(entry, 1); // cycle guard; the real tree has none beyond `bottom` itself, but stay safe
    let maxChild = 0;
    for (const child of entry.next) {
      maxChild = Math.max(maxChild, depthToBottom(child, memo));
    }
    const result = 1 + maxChild;
    memo.set(entry, result);
    return result;
  }

  function categoryDepth(root: readonly Layer[]): number {
    const memo = new Map<Layer, number>();
    let max = 0;
    for (const entry of root) {
      max = Math.max(max, depthToBottom(entry, memo));
    }
    return max;
  }

  /** The `layerN` at which `sampleAtLayer` is guaranteed to return a `bottom`-list rock, indexed by
   * `pointRock & TYPE_MASK` — see `categoryDepth`'s doc comment. Computed once at module load. */
  const BOTTOM_DEPTH: readonly [number, number, number, number] = [
    categoryDepth(ROOT_LAYERS[OCEAN]),
    categoryDepth(ROOT_LAYERS[VOLCANIC]),
    categoryDepth(ROOT_LAYERS[LAND]),
    categoryDepth(ROOT_LAYERS[3]),
  ];

  function rootLayersFor(pointRock: number): readonly Layer[] {
    const layers = ROOT_LAYERS[pointRock & TYPE_MASK];
    if (!layers) throw new Error(`RockLayerSettings: invalid rock type in pointRock=${pointRock}`);
    return layers;
  }

  /** `RockLayerSettings.sampleAtLayer(int pointRock, int layerN)`. `pointRock >> TYPE_BITS` is a
   * genuine Java `int` arithmetic shift — JS's `>>` on a 32-bit `pointRock` (itself already
   * int32-wrapped by `chooseRocks`'s `<<`/`|`, see `../biome/choose.ts`) matches it bit-for-bit,
   * including sign extension, with no BigInt widening needed before the shift. */
  function sampleAtLayer(pointRock: number, layerN: number): string {
    const random = XoroshiroRandomSource.fromSeed(BigInt(pointRock >> TYPE_BITS));
    const root = rootLayersFor(pointRock);
    const first = root[random.nextInt(root.length)];
    if (!first) throw new Error('RockLayerSettings: empty root layer list');
    let layer: Layer = first;
    for (let i = 0; i < layerN; i++) {
      const candidates = layer.next;
      const picked = candidates[random.nextInt(candidates.length)];
      if (!picked) throw new Error('RockLayerSettings: empty layer list mid-traversal');
      layer = picked;
    }
    return layer.rockId;
  }

  /** The `layerN` this port uses for the `RockStack.bottom` field: see `BOTTOM_DEPTH`'s doc comment.
   * Exposed so `sampleAtLayer(pointRock, bottomDepthFor(pointRock))` is always the deepest,
   * fully-converged rock for that point's category — never a hardcoded guess. */
  function bottomDepthFor(pointRock: number): number {
    const depth = BOTTOM_DEPTH[pointRock & TYPE_MASK];
    if (depth === undefined)
      throw new Error(`RockLayerSettings: invalid rock type in pointRock=${pointRock}`);
    return depth;
  }

  /** Every rock id `sampleAtLayer` can ever return — the datapack's own `rocks` map keys
   * (`src/data/tfc-1.20/rocks.json`), used by tests to catch a rock id this port could produce but
   * the game's own rock list does not recognise. */
  function knownRockIds(): ReadonlySet<string> {
    return new Set(
      [...NAMED_LAYERS.values()].flatMap((layers) => layers.map((layer) => layer.rockId)),
    );
  }

  /**
   * Per-`pointRock` memoisation of the full three-layer `RockStack` (`surface` always `null` here —
   * see `RockStack`'s doc comment for why). `sampleAtLayer`'s only randomness is seeded from
   * `pointRock` itself (see its doc comment above) and this datapack's rock-layer tree
   * (`NAMED_LAYERS`/`ROOT_LAYERS`) is a load-time constant, so `pointRock -> RockStack` is a pure,
   * world-seed-independent function — safe to memoise in one module-level cache shared by every
   * generator instance, profile session and worker.
   *
   * This is the fix for docs/PLAN.md section 6's measured rock-sampling bottleneck
   * (docs/FEEDBACK.md's 2026-09-07 entries): a real rock "area" patch (the zoomed/smoothed noise
   * `RegionGenerator.rockAt` reads, `../rock/layer.ts`) is typically thousands of blocks wide — a
   * direct measurement found only 2 distinct `pointRock` values across a full 256-block-wide tile at
   * five different seeds/locations, and a few dozen even at zoom 4's 4,096-block span — so calling
   * `sampleAtLayer` three times fresh (a new `XoroshiroRandomSource` plus a tree walk each time) for
   * every one of a tile's 65,536 pixels was, in practice, well over 99% redundant work. Returns the
   * *same* cached object on a hit — `RockStack`'s fields are all `readonly` and every caller only
   * reads them, so sharing one immutable instance across many pixels is safe and avoids allocating a
   * fresh object per pixel in this hot path (CLAUDE.md 6, "hot loops: avoid allocation").
   *
   * Bounded LRU with the same delete-then-reinsert eviction `RegionGenerator`'s region cache uses:
   * `pointRock` is an int32 drawn from an effectively unbounded uniform-noise range (`chooseRocks`,
   * `../biome/choose.ts`), so an unbounded map would leak memory over a long session panning across
   * many regions. 4,096 entries comfortably outlasts one viewport's worth of distinct rock areas
   * (measured well under a hundred even at a zoomed-out 4,096-block tile span, above) while staying
   * a trivially small map (each entry is three short interned strings).
   */
  const ROCK_STACK_CACHE_MAX = 4096;
  const rockStackCache = new Map<number, RockStack>();

  function rockStackAtPoint(pointRock: number): RockStack {
    const cached = rockStackCache.get(pointRock);
    if (cached !== undefined) {
      rockStackCache.delete(pointRock);
      rockStackCache.set(pointRock, cached);
      return cached;
    }
    const value: RockStack = {
      top: sampleAtLayer(pointRock, 0),
      middle: sampleAtLayer(pointRock, 1),
      bottom: sampleAtLayer(pointRock, bottomDepthFor(pointRock)),
      surface: null,
    };
    rockStackCache.set(pointRock, value);
    if (rockStackCache.size > ROCK_STACK_CACHE_MAX) {
      const oldestKey = rockStackCache.keys().next().value;
      if (oldestKey !== undefined) rockStackCache.delete(oldestKey);
    }
    return value;
  }

  /**
   * Every rock a column can be made of, top layer to bottom.
   *
   * `rockStackAtPoint` answers the three the readout shows; this answers "can this column contain
   * granite anywhere", which is what a vein's replacement table needs (`columnCanHost`). Memoised
   * per `pointRock`, so the whole stack is walked once per rock point rather than per vein.
   */
  const COLUMN_ROCKS = new Map<number, ReadonlySet<string>>();
  function columnRockIds(pointRock: number): ReadonlySet<string> {
    const cached = COLUMN_ROCKS.get(pointRock);
    if (cached) return cached;
    const rocks = new Set<string>();
    for (let layer = 0; layer <= bottomDepthFor(pointRock); layer++) {
      rocks.add(sampleAtLayer(pointRock, layer));
    }
    COLUMN_ROCKS.set(pointRock, rocks);
    return rocks;
  }

  return { sampleAtLayer, bottomDepthFor, knownRockIds, rockStackAtPoint, columnRockIds };
}

export const { sampleAtLayer, bottomDepthFor, knownRockIds, rockStackAtPoint, columnRockIds } =
  createRockLayerSampler(rocksData.rockLayers as unknown as RockLayersJson);
