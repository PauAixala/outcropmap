import { describe, expect, it, vi } from 'vitest';
import { tileKey } from '../../src/render/tiles/tile-key';
import { LruCache } from '../../src/render/tiles/lru-cache';
import { TileManager } from '../../src/render/tiles/tile-manager';
import { workerIndexForTile } from '../../src/workers/pool';
import { tileSpanBlocks } from '../../src/core/coords/coords';

describe('tileKey', () => {
  it('encodes seed|profile|layer|zoom|tx|tz', () => {
    const key = tileKey({ seed: '42', profile: 'tfg', layer: 'biome', zoom: 2, tileX: -1, tileZ: 3 });
    expect(key).toBe('42|tfg|biome|2|-1|3');
  });

  it('produces distinct keys for distinct tiles', () => {
    const a = tileKey({ seed: '1', profile: 'tfg', layer: 'biome', zoom: 0, tileX: 0, tileZ: 0 });
    const b = tileKey({ seed: '1', profile: 'tfg', layer: 'biome', zoom: 0, tileX: 0, tileZ: 1 });
    expect(a).not.toBe(b);
  });
});

describe('LruCache', () => {
  it('returns undefined for a missing key', () => {
    const cache = new LruCache<string, number>(2);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('evicts the least recently used entry once the bound is exceeded', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // over the bound of 2 -> evicts 'a' (oldest, untouched)
    expect(cache.has('a')).toBe(false);
    expect(evicted).toEqual(['a']);
    expect(cache.size).toBe(2);
  });

  it('a get() refreshes recency, protecting the entry from the next eviction', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, number>(2, (key) => evicted.push(key));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'a' is now the most recently used
    cache.set('c', 3); // should evict 'b', not 'a'
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(evicted).toEqual(['b']);
  });

  it('re-setting an existing key does not grow past the bound and calls no eviction', () => {
    const onEvict = vi.fn();
    const cache = new LruCache<string, number>(2, onEvict);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
    expect(onEvict).not.toHaveBeenCalled();
  });

  it('clear() empties the cache', () => {
    const cache = new LruCache<string, number>(4);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
  });

  it('clear() evicts every value so resource owners can release it', () => {
    const evicted: number[] = [];
    const cache = new LruCache<string, number>(2, (_key, value) => evicted.push(value));
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(evicted).toEqual([1, 2]);
  });
});

describe('TileManager zoom fallback', () => {
  it('routes zooms covering the same TFC region to the same worker', () => {
    const worker = workerIndexForTile({ zoom: 0, tileX: 0, tileZ: 0 }, 4);
    expect(workerIndexForTile({ zoom: 4, tileX: 0, tileZ: 0 }, 4)).toBe(worker);
    expect(workerIndexForTile({ zoom: 4, tileX: -1, tileZ: -1 }, 4)).toBe(workerIndexForTile({ zoom: 0, tileX: -1, tileZ: -1 }, 4));
  });

  it('returns intersecting tiles from an older zoom for placeholder painting, including negative tiles', async () => {
    let nextId = 1;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const pool = {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn(() => ({ id: nextId++, promise: Promise.resolve(bitmap) })),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 8 });
    manager.setSession(42n, 'tfg', 'overworld');
    manager.ensureVisible('biome', 0, -300, -300, -1, -1, {});
    await Promise.resolve();
    manager.ensureVisible('biome', 1, -300, -300, -1, -1, {});
    const fallback = manager.getCachedTiles('biome', -512, -512, -1, -1);
    expect(fallback.some((tile) => tile.zoom === 0)).toBe(true);
    manager.clearAll();
    expect(manager.getCachedTiles('biome', -512, -512, -1, -1)).toHaveLength(0);
  });

  it('drops a late result when a tile was cancelled and requested again', async () => {
    let nextId = 1;
    const pending = new Map<number, { resolve: (bitmap: ImageBitmap) => void }>();
    const oldBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const newBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const pool = {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn(() => {
        const id = nextId++;
        const promise = new Promise<ImageBitmap>((resolve) => pending.set(id, { resolve }));
        return { id, promise };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 8 });
    manager.setSession(42n, 'tfg', 'overworld');
    manager.ensureVisible('biome', 0, 0, 0, 0, 0, {});
    manager.ensureVisible('biome', 0, 512, 512, 512, 512, {});
    manager.ensureVisible('biome', 0, 0, 0, 0, 0, {});
    pending.get(1)?.resolve(oldBitmap);
    pending.get(3)?.resolve(newBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(oldBitmap.close).toHaveBeenCalledTimes(1);
    expect(manager.getTile('biome', 0, 0, 0)).toBe(newBitmap);
  });
});

describe('TileManager spiral scheduling', () => {
  // docs/FEEDBACK.md: "para recargar empieza por el chunk en el centro de la pantalla y en
  // espiral en sentido horario, ahora mismo parece aleatorio" -- these pin `ensureVisible`'s
  // request order against that complaint, not just `spiralOffsets` in isolation.

  function makeRecordingPool() {
    let nextId = 1;
    const requested: { tx: number; tz: number }[] = [];
    const pool = {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn((job: { tileX: number; tileZ: number }) => {
        requested.push({ tx: job.tileX, tz: job.tileZ });
        // Never resolves -- these tests only care about request order, not completion.
        return { id: nextId++, promise: new Promise<ImageBitmap>(() => {}) };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    return { pool, requested };
  }

  it('requests the tile under the viewport centre first, even off a tile boundary', () => {
    const { pool, requested } = makeRecordingPool();
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 64 });
    manager.setSession(1n, 'tfg', 'overworld');
    // Tile span at zoom 0 is 256 blocks. This box's midpoint is (-0.5, -0.5) -> tile (-1, -1),
    // not the midpoint of the tile-index range itself, which this must not fall back to.
    manager.ensureVisible('biome', 0, -300, -300, 299, 299, {});
    expect(requested[0]).toEqual({ tx: -1, tz: -1 });
  });

  it('requests every tile in the viewport exactly once', () => {
    const { pool, requested } = makeRecordingPool();
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 64 });
    manager.setSession(1n, 'tfg', 'overworld');
    manager.ensureVisible('biome', 0, -300, -300, 299, 299, {});
    // Tile span 256 blocks: x in [-300, 299] -> tiles -2..1, z the same -> a 4x4 viewport.
    const expected = new Set<string>();
    for (let tz = -2; tz <= 1; tz++) for (let tx = -2; tx <= 1; tx++) expected.add(`${tx},${tz}`);
    const seen = new Set(requested.map((r) => `${r.tx},${r.tz}`));
    expect(seen).toEqual(expected);
    expect(requested).toHaveLength(16);
  });

  it('walks outward in a clockwise spiral: distance from the centre never decreases', () => {
    const { pool, requested } = makeRecordingPool();
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 64 });
    manager.setSession(1n, 'tfg', 'overworld');
    manager.ensureVisible('biome', 0, -300, -300, 299, 299, {});
    const centre = requested[0]!;
    const distances = requested.map((r) => Math.max(Math.abs(r.tx - centre.tx), Math.abs(r.tz - centre.tz)));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });

  it('is stable: the same viewport produces the same request order every time', () => {
    const first = makeRecordingPool();
    const firstManager = new TileManager({ pool: first.pool, onTileReady: vi.fn(), maxTiles: 64 });
    firstManager.setSession(1n, 'tfg', 'overworld');
    firstManager.ensureVisible('biome', 0, -300, -300, 299, 299, {});

    const second = makeRecordingPool();
    const secondManager = new TileManager({ pool: second.pool, onTileReady: vi.fn(), maxTiles: 64 });
    secondManager.setSession(1n, 'tfg', 'overworld');
    secondManager.ensureVisible('biome', 0, -300, -300, 299, 299, {});

    expect(second.requested).toEqual(first.requested);
  });

  it('does not re-request a tile that is already cached, but keeps the spiral order for the rest', async () => {
    let nextId = 1;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const requested: { tx: number; tz: number }[] = [];
    const pool = {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn((job: { tileX: number; tileZ: number }) => {
        requested.push({ tx: job.tileX, tz: job.tileZ });
        return { id: nextId++, promise: Promise.resolve(bitmap) };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 64 });
    manager.setSession(1n, 'tfg', 'overworld');
    // Pre-populate the centre tile only, by requesting a viewport that is just that one tile.
    manager.ensureVisible('biome', 0, -1, -1, -1, -1, {});
    await Promise.resolve();
    requested.length = 0;
    manager.ensureVisible('biome', 0, -300, -300, 299, 299, {});
    // The centre tile (-1, -1) is already cached, so it is not re-requested, but every other
    // tile in the viewport still is, in spiral order starting from what would have been the
    // centre.
    expect(requested.some((r) => r.tx === -1 && r.tz === -1)).toBe(false);
    expect(requested).toHaveLength(15);
  });
});

describe('worker pool load balancing', () => {
  // Routing is by bucket, and the bucket is sized to a TFC region cell (12 288 blocks) — the unit a
  // worker caches. Two properties matter and are pinned here: tiles over one cell share a worker, so
  // that worker's region cache pays off; and a viewport that fits inside one bucket therefore uses a
  // single worker, which is why `WorkerPool.pickWorker` keeps a least-loaded fallback.
  it('routes every tile over one region cell to the same worker', () => {
    const cell = 12_288;
    for (const zoom of [2, 3, 4]) {
      const span = tileSpanBlocks(zoom);
      if (span >= cell) continue;
      const used = new Set<number>();
      // Tiles whose centres all fall inside the cell starting at the origin.
      for (let block = 0; block + span <= cell; block += span) {
        used.add(workerIndexForTile({ zoom, tileX: block / span, tileZ: 0 }, 8));
      }
      expect(used.size, `zoom ${zoom}`).toBe(1);
    }
  });

  it('spreads across the whole pool once the viewport covers several routing buckets', () => {
    const used = new Set<number>();
    for (let tz = -4; tz <= 4; tz++) {
      for (let tx = -4; tx <= 4; tx++) {
        used.add(workerIndexForTile({ zoom: 6, tileX: tx, tileZ: tz }, 8));
      }
    }
    expect(used.size).toBe(8);
  });

  it('routes the same area to the same worker across zoom levels', () => {
    const atZoom4 = workerIndexForTile({ zoom: 4, tileX: 2, tileZ: 2 }, 8);
    const atZoom3 = workerIndexForTile({ zoom: 3, tileX: 4, tileZ: 4 }, 8);
    expect(atZoom3).toBe(atZoom4);
  });
});

describe('TileManager.pendingLayers', () => {
  // Drives the loading compass: it names what the map is waiting for. It reads the in-flight keys
  // rather than a counter, so a key-format change must not silently turn it into noise.
  function makePool(pending: Map<number, (bitmap: ImageBitmap) => void>) {
    let nextId = 1;
    return {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn(() => {
        const id = nextId++;
        return { id, promise: new Promise<ImageBitmap>((resolve) => pending.set(id, resolve)) };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
  }

  it('reports each layer with tiles in flight, once, and nothing when idle', async () => {
    const pending = new Map<number, (bitmap: ImageBitmap) => void>();
    const manager = new TileManager({ pool: makePool(pending), onTileReady: vi.fn(), maxTiles: 8 });
    manager.setSession(42n, 'tfg', 'overworld');
    expect(manager.pendingLayers()).toEqual([]);

    // Two tiles of one layer plus one of another: the layer must not be reported twice.
    manager.ensureVisible('biome', 0, 0, 0, 300, 0, {});
    manager.ensureVisible('hillshade', 0, 0, 0, 0, 0, {});
    expect([...manager.pendingLayers()].sort()).toEqual(['biome', 'hillshade']);

    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    for (const resolve of pending.values()) resolve(bitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.pendingLayers()).toEqual([]);
  });
});

describe('TileManager.refine', () => {
  // "cuando haya cargado todo, usa el tiempo en cargar más resolución para el terreno ... con poca
  // prioridad": background detail for height layers, never more than a couple of requests at once.
  function setup() {
    const requests: { id: number; detail: number | undefined; tileX: number; resolve: (b: ImageBitmap) => void }[] = [];
    let nextId = 1;
    const pool = {
      cancel: vi.fn(),
      setSession: vi.fn(),
      requestTile: vi.fn((job: { detail?: number; tileX: number }) => {
        const id = nextId++;
        let resolve!: (b: ImageBitmap) => void;
        const promise = new Promise<ImageBitmap>((r) => (resolve = r));
        requests.push({ id, detail: job.detail, tileX: job.tileX, resolve });
        return { id, promise };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const manager = new TileManager({ pool, onTileReady: vi.fn(), maxTiles: 64 });
    manager.setSession(42n, 'tfg', 'overworld');
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };
    const bitmap = (tag: string) => ({ tag, close: vi.fn() }) as unknown as ImageBitmap;
    return { manager, requests, flush, bitmap };
  }

  // A 3-tile-wide strip at zoom 0 (256 blocks per tile).
  const box = [0, 0, 700, 10] as const;

  it('refines only after base tiles exist, within its budget, without counting as loading', async () => {
    const { manager, requests, flush, bitmap } = setup();
    manager.refine('hillshade', 0, ...box, {}, 2);
    expect(requests).toHaveLength(0); // nothing loaded yet, nothing to refine

    manager.ensureVisible('hillshade', 0, ...box, {});
    for (const r of [...requests]) r.resolve(bitmap(`base${r.tileX}`));
    await flush();
    requests.length = 0;

    manager.refine('hillshade', 0, ...box, {}, 2);
    expect(requests).toHaveLength(2); // three tiles want detail 1; the budget is two
    expect(requests.every((r) => r.detail === 1)).toBe(true);
    expect(manager.pendingLayers()).toEqual([]);
  });

  it('serves the refined tile, drops the base one, and does not fetch the base again', async () => {
    const { manager, requests, flush, bitmap } = setup();
    manager.ensureVisible('hillshade', 0, ...box, {});
    // Keyed by tile, not request order: requests go out in spiral order, centre first.
    const base = new Map<number, ImageBitmap>();
    for (const r of requests) {
      const b = bitmap(`base${r.tileX}`);
      base.set(r.tileX, b);
      r.resolve(b);
    }
    await flush();
    requests.length = 0;

    manager.refine('hillshade', 0, ...box, {}, 2);
    const first = requests[0]!;
    const sharp = bitmap('sharp');
    first.resolve(sharp);
    await flush();

    expect(manager.getTile('hillshade', 0, first.tileX, 0)).toBe(sharp);
    expect((base.get(first.tileX) as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    const before = requests.length;
    manager.ensureVisible('hillshade', 0, ...box, {});
    expect(requests.length).toBe(before); // a refined tile is not a missing base tile
  });

  it('moves to the next detail only once every visible tile has the previous one', async () => {
    const { manager, requests, flush, bitmap } = setup();
    manager.ensureVisible('hillshade', 0, ...box, {});
    for (const r of [...requests]) r.resolve(bitmap('base'));
    await flush();
    requests.length = 0;

    for (let round = 0; round < 4; round++) {
      manager.refine('hillshade', 0, ...box, {}, 2);
      for (const r of requests.splice(0)) {
        expect(r.detail).toBe(round < 2 ? 1 : 2);
        r.resolve(bitmap('d'));
      }
      await flush();
    }
  });

  it('stops at the max detail it is given', async () => {
    const { manager, requests, flush, bitmap } = setup();
    manager.ensureVisible('hillshade', 0, ...box, {});
    for (const r of [...requests]) r.resolve(bitmap('base'));
    await flush();
    requests.length = 0;
    manager.refine('hillshade', 0, ...box, {}, 0);
    expect(requests).toHaveLength(0);
  });
});

describe('FeatureManager deposits per ore', () => {
  it('asks only for ores a region does not have yet, and merges what it has', async () => {
    const calls: { ores: readonly string[] | undefined }[] = [];
    const resolvers: ((set: unknown) => void)[] = [];
    const pool = {
      requestFeatures: vi.fn((_box: unknown, _kinds: unknown, ores?: readonly string[]) => {
        calls.push({ ores });
        return { id: calls.length, promise: new Promise((resolve) => resolvers.push(resolve)) };
      }),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const { FeatureManager } = await import('../../src/render/tiles/feature-manager');
    const manager = new FeatureManager({ pool, onFeaturesReady: vi.fn() });
    manager.setSession(42n, 'tfg', 'overworld');
    const deposit = (ore: string, x: number) => ({ id: `${ore}${x}`, ore: `tfg:${ore}`, x, z: 10 });

    manager.ensureVisible(0, 0, 100, 100, 'deposits', ['copper']);
    expect(calls).toEqual([{ ores: ['copper'] }]);
    resolvers[0]!({ deposits: [deposit('copper', 5)], structures: [] });
    await Promise.resolve();
    await Promise.resolve();

    // Adding a second ore requests only that one.
    manager.ensureVisible(0, 0, 100, 100, 'deposits', ['copper', 'gold']);
    expect(calls[1]).toEqual({ ores: ['gold'] });
    resolvers[1]!({ deposits: [deposit('gold', 7)], structures: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.depositsInView(0, 0, 100, 100, ['copper', 'gold']).map((d) => d.id).sort()).toEqual(['copper5', 'gold7']);
    expect(manager.depositsInView(0, 0, 100, 100, ['gold']).map((d) => d.id)).toEqual(['gold7']);
    // Nothing new to ask for.
    manager.ensureVisible(0, 0, 100, 100, 'deposits', ['gold', 'copper']);
    expect(calls).toHaveLength(2);
  });

  it('a region loaded per ore answers nothing to an unfiltered query -- callers must pass their filter', async () => {
    // The trap behind "I can see the marker but clicking does nothing": with an ore selected, only
    // that ore's per-region list exists, and asking for everything reads a whole-region entry that
    // was never fetched. The map's click hit-test passes its ore filter for exactly this reason.
    const resolvers: ((set: unknown) => void)[] = [];
    const pool = {
      requestFeatures: vi.fn(() => ({
        id: resolvers.length + 1,
        promise: new Promise((resolve) => resolvers.push(resolve)),
      })),
    } as unknown as import('../../src/workers/pool').WorkerPool;
    const { FeatureManager } = await import('../../src/render/tiles/feature-manager');
    const manager = new FeatureManager({ pool, onFeaturesReady: vi.fn() });
    manager.setSession(42n, 'tfg', 'overworld');

    manager.ensureVisible(0, 0, 100, 100, 'deposits', ['gold']);
    resolvers[0]!({ deposits: [{ id: 'gold7', ore: 'tfg:gold', x: 7, z: 10 }], structures: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.depositsInView(0, 0, 100, 100, ['gold']).map((d) => d.id)).toEqual(['gold7']);
    expect(manager.depositsInView(0, 0, 100, 100)).toEqual([]);
  });
});
