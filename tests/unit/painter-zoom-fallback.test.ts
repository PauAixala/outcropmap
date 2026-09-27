import { describe, expect, it } from 'vitest';
import { paintFrame, type PaintOptions } from '../../src/render/canvas2d/painter';
import type { TileManager } from '../../src/render/tiles/tile-manager';
import type { Camera } from '../../src/core/coords/coords';

/**
 * Zooming must not blank the map: until the new zoom's tiles arrive, whatever is already cached at
 * another zoom is stretched into the gap (the slippy-map placeholder).
 *
 * Zooming *in* one coarser tile covers the gap entirely. Zooming *out* the tiles being replaced are
 * each smaller than the gap, so drawing a single source leaves a patch surrounded by nothing — the
 * "it redraws from scratch when I zoom out" report. Every overlapping tile has to be drawn.
 */
interface Drawn {
  readonly id: string;
}

function makeCtx(drawn: string[]): CanvasRenderingContext2D {
  const ctx = {
    canvas: { width: 4, height: 4 },
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'top',
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    rect: () => {},
    clip: () => {},
    bezierCurveTo: () => {},
    arc: () => {},
    translate: () => {},
    fill: () => {},
    stroke: () => {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    strokeText: () => {},
    fillText: () => {},
    drawImage: (bitmap: unknown) => {
      drawn.push((bitmap as Drawn).id);
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

/** Nothing ready at the current zoom; `cached` stands in for what earlier zooms left behind. */
function makeTiles(cached: { zoom: number; tileX: number; tileZ: number }[]): TileManager {
  return {
    ensureVisible: () => {},
    getTile: () => undefined,
    pendingLayers: () => [],
    refine: () => {},
    getCachedTiles: () =>
      cached.map((tile) => ({
        ...tile,
        bitmap: { id: `${tile.zoom}:${tile.tileX},${tile.tileZ}` } as unknown as ImageBitmap,
      })),
  } as unknown as TileManager;
}

// One visible tile: a 4x4 px viewport centred inside tile 195,195 at zoom 1 (512-block span).
const CAMERA: Camera = { centerX: 100_000, centerZ: 100_000, zoom: 1 };

function paint(cached: { zoom: number; tileX: number; tileZ: number }[]): string[] {
  const drawn: string[] = [];
  const opts: PaintOptions = {
    ctx: makeCtx(drawn),
    width: 4,
    height: 4,
    camera: CAMERA,
    layers: ['biome'],
    showGrid: false,
    tiles: makeTiles(cached),
    palette: {},
  };
  paintFrame(opts);
  return drawn;
}

describe('cross-zoom placeholder', () => {
  it('zooming out, covers the gap with every finer tile that overlaps it', () => {
    // Tile 195,195 at zoom 1 spans 99 840..100 352; at zoom 0 that is tiles 390..391 on each axis.
    const finer = [
      { zoom: 0, tileX: 390, tileZ: 390 },
      { zoom: 0, tileX: 391, tileZ: 390 },
      { zoom: 0, tileX: 390, tileZ: 391 },
      { zoom: 0, tileX: 391, tileZ: 391 },
    ];
    expect(paint(finer).sort()).toEqual([
      '0:390,390',
      '0:390,391',
      '0:391,390',
      '0:391,391',
    ]);
  });

  it('zooming in, one coarser tile is enough', () => {
    expect(paint([{ zoom: 2, tileX: 97, tileZ: 97 }])).toEqual(['2:97,97']);
  });

  it('draws the coarser tile first, so finer detail lands on top of it', () => {
    const drawn = paint([
      { zoom: 0, tileX: 390, tileZ: 390 },
      { zoom: 2, tileX: 97, tileZ: 97 },
    ]);
    expect(drawn).toEqual(['2:97,97', '0:390,390']);
  });

  it('ignores cached tiles that do not overlap the gap', () => {
    expect(paint([{ zoom: 0, tileX: 500, tileZ: 500 }])).toEqual([]);
  });
});
