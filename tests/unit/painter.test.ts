import { describe, expect, it } from 'vitest';
import {
  MIN_GRID_LINE_SPACING_PX,
  chooseGridLevel,
  orderLayersForPaint,
  paintFrame,
} from '../../src/render/canvas2d/painter';
import type { GridLevel, PaintOptions } from '../../src/render/canvas2d/painter';
import type { LayerId } from '../../src/worldgen/api/types';
import type { CachedTile, TileManager } from '../../src/render/tiles/tile-manager';
import type { Camera } from '../../src/core/coords/coords';
import { CHUNK_SIZE, MC_REGION_SIZE, blocksPerPixel } from '../../src/core/coords/coords';
import type { Waypoint } from '../../src/app/waypoints';

describe('orderLayersForPaint (ADR 0007)', () => {
  it('sorts by LayerDefinition.order regardless of input order', () => {
    const shuffled: LayerId[] = [
      'region-debug',
      'rainfall',
      'grid',
      'biome',
      'temperature',
      'rock',
    ];
    expect(orderLayersForPaint(shuffled)).toEqual([
      'biome',
      'rock',
      'temperature',
      'rainfall',
      'region-debug',
      'grid',
    ]);
  });

  it('puts every overlay above every base', () => {
    const order = orderLayersForPaint(['temperature', 'biome', 'rainfall', 'rock']);
    const bases: LayerId[] = ['biome', 'rock'];
    const overlays: LayerId[] = ['temperature', 'rainfall'];
    const lastBaseIndex = Math.max(...bases.map((id) => order.indexOf(id)));
    const firstOverlayIndex = Math.min(...overlays.map((id) => order.indexOf(id)));
    expect(firstOverlayIndex).toBeGreaterThan(lastBaseIndex);
  });

  it('is deterministic: the same set in a different order produces the same result', () => {
    const a = orderLayersForPaint(['temperature', 'biome', 'rock']);
    const b = orderLayersForPaint(['rock', 'temperature', 'biome']);
    expect(a).toEqual(b);
  });

  it('is a pure function: the input array is not mutated', () => {
    const input: LayerId[] = ['temperature', 'biome'];
    const copy = [...input];
    orderLayersForPaint(input);
    expect(input).toEqual(copy);
  });
});

/**
 * Minimal fake CanvasRenderingContext2D: records every call that matters for paint order and
 * alpha, and no-ops everything else paintFrame touches. No real <canvas> is available under
 * Vitest's default (node) environment, and none is needed -- paintFrame never reads back from the
 * context, only writes to it.
 */
interface DrawEvent {
  readonly kind: 'draw' | 'grid' | 'waypoint';
  readonly layer?: LayerId;
  readonly alpha: number;
}

function makeFakeCtx(events: DrawEvent[]): CanvasRenderingContext2D {
  let alphaStack: number[] = [1];
  const ctx = {
    get globalAlpha(): number {
      return alphaStack[alphaStack.length - 1] ?? 1;
    },
    set globalAlpha(value: number) {
      alphaStack[alphaStack.length - 1] = value;
    },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    fillRect: () => {},
    save: () => {
      alphaStack.push(alphaStack[alphaStack.length - 1] ?? 1);
    },
    restore: () => {
      alphaStack.pop();
    },
    beginPath: () => {},
    closePath: () => {},
    rect: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    bezierCurveTo: () => {},
    arc: () => {},
    translate: () => {},
    fill: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    strokeText: () => {},
    fillText: () => {
      events.push({ kind: 'waypoint', alpha: ctx.globalAlpha });
    },
    stroke: () => {
      events.push({ kind: 'grid', alpha: ctx.globalAlpha });
    },
    drawImage: (bitmap: unknown) => {
      events.push({
        kind: 'draw',
        layer: (bitmap as { layer: LayerId }).layer,
        alpha: ctx.globalAlpha,
      });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** A fake TileManager that always has exactly one ready tile per layer, covering the whole
 * viewport, so paintFrame's "exact tile" path fires exactly once per enabled layer. */
function makeFakeTiles(): TileManager {
  return {
    ensureVisible: () => {},
    getCachedTiles: (): CachedTile[] => [],
    getTile: (layer: LayerId) => ({ layer }) as unknown as ImageBitmap,
    pendingLayers: (): LayerId[] => [],
    refine: () => {},
  } as unknown as TileManager;
}

// Centred well inside a single tile (zoom 0 -> a 256-block tile span) so exactly one tile
// column/row is visible and each raster layer draws exactly once -- keeps the fake tile manager
// and the assertions below simple. zoom 0 (bpp 1) also keeps the grid at its 'region' level (see
// chooseGridLevel below) rather than 'none', so the grid-goes-last assertion still exercises a
// real stroke() call instead of the grid silently opting out.
const CAMERA: Camera = { centerX: 100000, centerZ: 100000, zoom: 0 };

function paint(
  layers: readonly LayerId[],
  layerOpacity?: Partial<Record<LayerId, number>>,
): DrawEvent[] {
  const events: DrawEvent[] = [];
  const opts: PaintOptions = {
    ctx: makeFakeCtx(events),
    width: 4,
    height: 4,
    camera: CAMERA,
    layers,
    showGrid: true,
    tiles: makeFakeTiles(),
    palette: {},
    ...(layerOpacity !== undefined ? { layerOpacity } : {}),
  };
  paintFrame(opts);
  return events;
}

describe('paintFrame layer ordering and alpha (ADR 0007)', () => {
  it('paints bases before overlays before the grid, regardless of enabledLayers order', () => {
    const events = paint(['temperature', 'biome', 'rainfall', 'rock']);
    const drawOrder = events.filter((e) => e.kind === 'draw').map((e) => e.layer);
    expect(drawOrder).toEqual(['biome', 'rock', 'temperature', 'rainfall']);
    // The grid is drawn strictly after every raster layer.
    expect(events[events.length - 1]?.kind).toBe('grid');
  });

  it('draw order is identical no matter what order the enabled layers are listed in', () => {
    const a = paint(['rainfall', 'temperature', 'biome', 'rock'])
      .filter((e) => e.kind === 'draw')
      .map((e) => e.layer);
    const b = paint(['biome', 'rock', 'rainfall', 'temperature'])
      .filter((e) => e.kind === 'draw')
      .map((e) => e.layer);
    expect(a).toEqual(b);
  });

  it('paints each layer at its own resolved opacity: override when present, defaultOpacity otherwise', () => {
    const events = paint(['biome', 'temperature'], { temperature: 0.3 });
    const byLayer = new Map(events.filter((e) => e.kind === 'draw').map((e) => [e.layer, e.alpha]));
    expect(byLayer.get('biome')).toBe(1); // categorical base default (ADR 0007)
    expect(byLayer.get('temperature')).toBe(0.3); // explicit override wins over the 0.55 default
  });

  it('two opaque bases enabled together both paint -- no exclusivity, alpha compositing decides visibility', () => {
    const events = paint(['biome', 'rock']);
    const drawOrder = events.filter((e) => e.kind === 'draw').map((e) => e.layer);
    expect(drawOrder).toEqual(['biome', 'rock']);
  });

  it('paints user waypoints after the grid so they remain visible above map data', () => {
    const events: DrawEvent[] = [];
    const waypoint: Waypoint = {
      id: 'home',
      x: CAMERA.centerX,
      z: CAMERA.centerZ,
      label: 'Home',
      icon: 'house',
      colour: 'wp-red',
    };
    paintFrame({
      ctx: makeFakeCtx(events),
      width: 4,
      height: 4,
      camera: CAMERA,
      layers: ['biome'],
      showGrid: true,
      tiles: makeFakeTiles(),
      palette: {},
      waypoints: [waypoint],
    });
    expect(events[0]?.kind).toBe('draw');
    expect(events.slice(1, -1).every((event) => event.kind === 'grid')).toBe(true);
    expect(events.at(-1)?.kind).toBe('waypoint');
  });
});

/**
 * Grid density by zoom: the grid must pick chunk
 * lines, then region lines, then nothing, based on whether the resulting on-screen spacing clears
 * `MIN_GRID_LINE_SPACING_PX` -- never draw a spacing denser than that threshold.
 */
describe('chooseGridLevel (FEEDBACK.md section 5: grid density by zoom)', () => {
  it('picks chunk lines once zoomed in enough that they clear the minimum spacing', () => {
    // bpp small enough that CHUNK_SIZE / bpp is comfortably over the threshold.
    const bpp = CHUNK_SIZE / (MIN_GRID_LINE_SPACING_PX * 4);
    expect(chooseGridLevel(bpp)).toBe('chunk');
  });

  it('falls back to region lines once chunk lines would be denser than the minimum, as long as region lines still clear it', () => {
    // Pick a bpp between "chunk lines too dense" and "region lines too dense".
    const bpp = MC_REGION_SIZE / (MIN_GRID_LINE_SPACING_PX * 2);
    expect(CHUNK_SIZE / bpp).toBeLessThan(MIN_GRID_LINE_SPACING_PX);
    expect(chooseGridLevel(bpp)).toBe('region');
  });

  it('draws nothing once even region lines would be denser than the minimum -- the actual bug reported', () => {
    // bpp large enough that even MC_REGION_SIZE / bpp falls under the threshold.
    const bpp = MC_REGION_SIZE / (MIN_GRID_LINE_SPACING_PX / 2);
    expect(chooseGridLevel(bpp)).toBe('none');
  });

  it('is monotonic: as bpp increases (zooming out), the level only ever gets coarser, never finer', () => {
    const order: Record<GridLevel, number> = { chunk: 0, region: 1, none: 2 };
    let previous = order.chunk;
    // Sweep across the full documented zoom range (MIN_ZOOM..MAX_ZOOM from coords.ts).
    for (let zoom = -4; zoom <= 10; zoom += 0.25) {
      const level = chooseGridLevel(blocksPerPixel(zoom));
      expect(order[level]).toBeGreaterThanOrEqual(previous);
      previous = order[level];
    }
  });

  it('never returns a level whose spacing is below the minimum pixel threshold', () => {
    for (let zoom = -4; zoom <= 10; zoom += 0.1) {
      const bpp = blocksPerPixel(zoom);
      const level = chooseGridLevel(bpp);
      if (level === 'chunk') {
        expect(CHUNK_SIZE / bpp).toBeGreaterThanOrEqual(MIN_GRID_LINE_SPACING_PX);
      } else if (level === 'region') {
        expect(MC_REGION_SIZE / bpp).toBeGreaterThanOrEqual(MIN_GRID_LINE_SPACING_PX);
      } else {
        // 'none': confirm it wasn't skipped by mistake -- neither spacing actually clears it.
        expect(CHUNK_SIZE / bpp).toBeLessThan(MIN_GRID_LINE_SPACING_PX);
        expect(MC_REGION_SIZE / bpp).toBeLessThan(MIN_GRID_LINE_SPACING_PX);
      }
    }
  });

  it('matches the reported bug: the "scale bar reads 5k blocks" zoom no longer draws a dense wash', () => {
    // scale bar shows ~100px == best-rounded(rawBlocks); rawBlocks = 100 * bpp. A ~5000-block
    // reading corresponds to bpp ~= 50 (see mountScaleBar in panels.ts).
    const bpp = 50;
    expect(chooseGridLevel(bpp)).not.toBe('chunk');
    if (chooseGridLevel(bpp) === 'region') {
      expect(MC_REGION_SIZE / bpp).toBeGreaterThanOrEqual(MIN_GRID_LINE_SPACING_PX);
    }
  });
});

describe('paintFrame: phased loading', () => {
  // "primero carga el 2d, cuando esté el 2d carga el 3d" -- the base map has to arrive before the
  // relief on top of it is even requested, so there is something to look at while it generates.
  let refined: LayerId[] = [];
  function paintWithPending(layers: readonly LayerId[], pending: readonly LayerId[]): LayerId[] {
    const requested: LayerId[] = [];
    refined = [];
    const tiles = {
      ensureVisible: (layer: LayerId) => {
        requested.push(layer);
      },
      getCachedTiles: (): CachedTile[] => [],
      // No tile is ready: this is the state during a load, which is when phasing matters.
      getTile: () => undefined,
      pendingLayers: (): readonly LayerId[] => pending,
      refine: (layer: LayerId) => {
        refined.push(layer);
      },
    } as unknown as TileManager;
    paintFrame({
      ctx: makeFakeCtx([]),
      width: 4,
      height: 4,
      camera: CAMERA,
      layers,
      showGrid: false,
      tiles,
      palette: {},
    });
    return requested;
  }

  it('requests the base layer and holds the relief back while the base is still in flight', () => {
    expect(paintWithPending(['biome', 'hillshade'], ['biome'])).toEqual(['biome']);
  });

  it('requests the relief once nothing earlier is in flight', () => {
    expect(paintWithPending(['biome', 'hillshade'], [])).toEqual(['biome', 'hillshade']);
  });

  it('refines height layers only once nothing is loading, and never plain ones', () => {
    paintWithPending(['biome', 'hillshade'], ['biome']);
    expect(refined).toEqual([]);
    paintWithPending(['biome', 'hillshade'], []);
    expect(refined).toEqual(['hillshade']);
  });

  it('does not let a later layer hold back an earlier one', () => {
    expect(paintWithPending(['biome', 'hillshade'], ['hillshade'])).toEqual(['biome', 'hillshade']);
  });
});
