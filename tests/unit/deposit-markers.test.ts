import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import '@worldgen/profiles';
import { listProfiles } from '@worldgen/registry';
import type { DepositFeature, ProfileId } from '@worldgen/api/types';
import { colorToCss } from '@render/colormap';
import { depositStyle } from '@render/deposit-style';
import type { DepositShape } from '@render/deposit-style';
import {
  DEPOSIT_HALO_PX,
  DEPOSIT_HIT_RADIUS_PX,
  DEPOSIT_MARKER_LAYERS,
  DEPOSIT_MARKER_REACH_PX,
  DEPOSIT_OUTLINE_PX,
  DEPOSIT_SHAPES,
  DEPOSIT_SWATCH_PX,
  depositMarkerPathData,
  depositSwatchSpec,
  depositSwatchViewBox,
  growPolygon,
  snapMarkerCoordinate,
  traceDepositMarker,
} from '@render/markers';
import type { DepositMarkerLayer, MarkerPathSink } from '@render/markers';
import { paintFrame } from '@render/canvas2d/painter';
import type { CachedTile, TileManager } from '@render/tiles/tile-manager';

/**
 * Deposit markers: the geometry the painter draws and the ore filter's swatch shows, the two-tone
 * ring's tokens, and that the swatch and the map agree (docs/PLAN.md 20.1).
 */

/** One traced layer: a polygon's vertices, or a circle's centre and radius. */
interface Traced {
  readonly points: number[];
  radius: number | null;
  centre: readonly [number, number] | null;
  closed: boolean;
}

function trace(shape: DepositShape, layer: DepositMarkerLayer, cx = 0, cy = 0): Traced {
  const traced: Traced = { points: [], radius: null, centre: null, closed: false };
  const sink: MarkerPathSink = {
    moveTo: (x, y) => {
      traced.points.push(x, y);
    },
    lineTo: (x, y) => {
      traced.points.push(x, y);
    },
    arc: (x, y, radius, start, end) => {
      expect(end - start).toBeCloseTo(Math.PI * 2, 12);
      traced.radius = radius;
      traced.centre = [x, y];
    },
    closePath: () => {
      traced.closed = true;
    },
  };
  traceDepositMarker(sink, shape, layer, cx, cy);
  return traced;
}

/** The traced outline as points: a polygon's vertices, or 64 points around a circle. */
function outlinePoints(traced: Traced): number[] {
  if (traced.radius === null || traced.centre === null) return traced.points;
  const points: number[] = [];
  for (let i = 0; i < 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    points.push(
      traced.centre[0] + traced.radius * Math.cos(angle),
      traced.centre[1] + traced.radius * Math.sin(angle),
    );
  }
  return points;
}

function area(traced: Traced): number {
  if (traced.radius !== null) return Math.PI * traced.radius ** 2;
  const p = traced.points;
  let twice = 0;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    twice += p[i]! * p[j + 1]! - p[j]! * p[i + 1]!;
  }
  return Math.abs(twice) / 2;
}

function bounds(points: readonly number[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const xs = points.filter((_, i) => i % 2 === 0);
  const ys = points.filter((_, i) => i % 2 === 1);
  return {
    left: -Math.min(...xs),
    top: -Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/** Numbers in SVG path data, in order. */
function pathNumbers(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/**
 * Each fill as specified (src/render/markers.ts): how far it reaches from the deposit's point to the
 * left, top, right and bottom, CSS px. The triangle is equilateral and point up around its centroid,
 * 4 px from the centroid to each side.
 */
const FILL_EXTENT: Readonly<Record<DepositShape, readonly [number, number, number, number]>> = {
  circle: [5, 5, 5, 5],
  diamond: [6, 6, 6, 6],
  square: [4.5, 4.5, 4.5, 4.5],
  triangle: [4 * Math.sqrt(3), 8, 4 * Math.sqrt(3), 4],
};

describe('deposit marker geometry', () => {
  it('draws each fill exactly to its declared extent, never past it', () => {
    const round = (value: number): number => Number(value.toFixed(9));
    for (const shape of DEPOSIT_SHAPES) {
      const box = bounds(outlinePoints(trace(shape, 'fill')));
      const [left, top, right, bottom] = FILL_EXTENT[shape];
      expect([shape, round(box.left), round(box.top), round(box.right), round(box.bottom)]).toEqual(
        [shape, round(left), round(top), round(right), round(bottom)],
      );
    }
  });

  it('gives the four shapes the area of the old 5 px circle, within 15%', () => {
    const circle = area(trace('circle', 'fill'));
    expect(circle).toBeCloseTo(Math.PI * 25, 9);
    for (const shape of DEPOSIT_SHAPES) {
      const ratio = area(trace(shape, 'fill')) / circle;
      expect([shape, ratio > 0.85 && ratio < 1.15]).toEqual([shape, true]);
    }
  });

  it('lets the pointed shapes reach further than the square, which carries its area in its corners', () => {
    const reach = (shape: DepositShape): number => Math.max(...FILL_EXTENT[shape]);
    expect(reach('diamond')).toBeGreaterThan(reach('square'));
    expect(reach('triangle')).toBeGreaterThan(reach('square'));
  });

  it('keeps every layer of every marker inside the cull margin and the click radius', () => {
    for (const shape of DEPOSIT_SHAPES) {
      for (const layer of DEPOSIT_MARKER_LAYERS) {
        const points = outlinePoints(trace(shape, layer));
        const box = bounds(points);
        expect([
          shape,
          layer,
          Math.max(box.left, box.top, box.right, box.bottom) <= DEPOSIT_MARKER_REACH_PX + 1e-9,
        ]).toEqual([shape, layer, true]);
        for (let i = 0; i < points.length; i += 2) {
          expect(Math.hypot(points[i]!, points[i + 1]!)).toBeLessThanOrEqual(
            DEPOSIT_HIT_RADIUS_PX + 1e-9,
          );
        }
      }
    }
  });

  it('nests the ring: the outline sits exactly its width outside the fill, the halo its width outside that', () => {
    for (const shape of DEPOSIT_SHAPES) {
      const fill = trace(shape, 'fill');
      const growth: Record<DepositMarkerLayer, number> = {
        fill: 0,
        outline: DEPOSIT_OUTLINE_PX,
        halo: DEPOSIT_OUTLINE_PX + DEPOSIT_HALO_PX,
      };
      for (const layer of DEPOSIT_MARKER_LAYERS) {
        const grown = trace(shape, layer);
        if (fill.radius !== null) {
          expect(grown.radius).toBeCloseTo(fill.radius + growth[layer], 12);
          continue;
        }
        // Each grown edge runs parallel to its fill edge, `growth` further out.
        const p = fill.points;
        const g = grown.points;
        expect(g.length).toBe(p.length);
        for (let i = 0; i < p.length; i += 2) {
          const j = (i + 2) % p.length;
          const ex = p[j]! - p[i]!;
          const ey = p[j + 1]! - p[i + 1]!;
          const length = Math.hypot(ex, ey);
          // Distance of both grown endpoints from the fill edge's line, on the outward side.
          for (const k of [i, j]) {
            const cross = (ex * (g[k + 1]! - p[i + 1]!) - ey * (g[k]! - p[i]!)) / length;
            expect(Math.abs(cross)).toBeCloseTo(growth[layer], 9);
          }
        }
        expect(area(grown)).toBeGreaterThanOrEqual(area(fill));
      }
    }
  });

  it('grows a polygon outward whichever way round it is listed', () => {
    const clockwise = [-1, -1, 1, -1, 1, 1, -1, 1];
    const anticlockwise = [-1, 1, 1, 1, 1, -1, -1, -1];
    expect(growPolygon(clockwise, 1)).toEqual([-2, -2, 2, -2, 2, 2, -2, 2]);
    expect(growPolygon(anticlockwise, 1)).toEqual([-2, 2, 2, 2, 2, -2, -2, -2]);
  });

  it('traces around the point it is given, and closes the path', () => {
    for (const shape of DEPOSIT_SHAPES) {
      const atOrigin = outlinePoints(trace(shape, 'fill'));
      const moved = trace(shape, 'fill', 30.5, -12);
      expect(moved.closed).toBe(true);
      const movedPoints = outlinePoints(moved);
      for (let i = 0; i < atOrigin.length; i += 2) {
        expect(movedPoints[i]! - 30.5).toBeCloseTo(atOrigin[i]!, 9);
        expect(movedPoints[i + 1]! + 12).toBeCloseTo(atOrigin[i + 1]!, 9);
      }
    }
  });

  it('snaps the square and the triangle base onto whole device pixels at ratios 1 and 2', () => {
    for (const raw of [0, 0.25, 0.5, 0.75, 13.4, 13.6, -7.2, 511.99]) {
      const squareX = snapMarkerCoordinate('square', raw);
      const triangleY = snapMarkerCoordinate('triangle', raw);
      expect(Math.abs(squareX - raw)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(triangleY - raw)).toBeLessThanOrEqual(0.5);
      for (const layer of DEPOSIT_MARKER_LAYERS) {
        const square = trace('square', layer, squareX, 0).points;
        const triangle = trace('triangle', layer, 0, triangleY).points;
        const base = Math.max(...triangle.filter((_, i) => i % 2 === 1));
        const whole = (value: number): boolean => Number.isInteger(Number(value.toFixed(9)));
        for (const dpr of [1, 2]) {
          for (let i = 0; i < square.length; i += 2)
            expect([layer, raw, whole(square[i]! * dpr)]).toEqual([layer, raw, true]);
          expect([layer, raw, whole(base * dpr)]).toEqual([layer, raw, true]);
        }
      }
    }
  });

  it('writes the swatch path data from the same outline the painter traces', () => {
    for (const shape of DEPOSIT_SHAPES) {
      for (const layer of DEPOSIT_MARKER_LAYERS) {
        const traced = trace(shape, layer);
        const numbers = pathNumbers(depositMarkerPathData(shape, layer));
        // Path data carries three decimals.
        if (traced.radius !== null) {
          expect(numbers[0]).toBeCloseTo(traced.radius, 2);
          expect(depositMarkerPathData(shape, layer)).toContain('A');
        } else {
          expect(numbers.length).toBe(traced.points.length);
          numbers.forEach((n, i) => expect(n).toBeCloseTo(traced.points[i]!, 2));
        }
      }
    }
  });
});

/** The three theme states base.css declares tokens in (ADR 0005). */
const CSS = readFileSync(join(process.cwd(), 'src/ui/styles/base.css'), 'utf8');
const THEME_STATES = [
  { name: 'light', selector: ':root {' },
  { name: 'system dark', selector: ":root:not([data-theme='light']) {" },
  { name: 'explicit dark', selector: ":root[data-theme='dark'] {" },
] as const;

function tokensOf(selector: string): Record<string, number> {
  const start = CSS.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  const block = CSS.slice(start, CSS.indexOf('}', start));
  const tokens: Record<string, number> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*#([0-9a-f]{6});/g))
    tokens[m[1]!] = Number.parseInt(m[2]!, 16);
  return tokens;
}

/** WCAG 2.1 relative luminance and contrast ratio. */
function luminance(color: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((color >> 16) & 255) +
    0.7152 * channel((color >> 8) & 255) +
    0.0722 * channel(color & 255)
  );
}
function contrast(a: number, b: number): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the two-tone ring', () => {
  it('declares both ring tokens, as hex, in every theme state', () => {
    for (const state of THEME_STATES) {
      const tokens = tokensOf(state.selector);
      expect([
        state.name,
        tokens['marker-outline'] !== undefined,
        tokens['marker-halo'] !== undefined,
      ]).toEqual([state.name, true, true]);
    }
  });

  it('is dark inside and light outside, in every theme state', () => {
    for (const state of THEME_STATES) {
      const tokens = tokensOf(state.selector);
      expect([
        state.name,
        luminance(tokens['marker-halo']!) > luminance(tokens['marker-outline']!),
      ]).toEqual([state.name, true]);
    }
  });

  it('stands out from any ground at all: one band clears 3:1 against every possible colour', () => {
    // For a ground between the two bands in luminance, contrast(halo, ground) times
    // contrast(ground, outline) equals contrast(halo, outline), so the larger of the two is at
    // least its square root; a ground outside that range is further from one band still. A ring
    // whose bands differ by 9:1 therefore has a band at 3:1 (WCAG's non-text minimum) against
    // every raster layer that could ever be under it.
    for (const state of THEME_STATES) {
      const tokens = tokensOf(state.selector);
      const ratio = contrast(tokens['marker-halo']!, tokens['marker-outline']!);
      expect([state.name, Math.sqrt(ratio) >= 3]).toEqual([state.name, true]);
    }
  });

  it('has a band at 4.5:1 against the bare map ground of its own theme', () => {
    for (const state of THEME_STATES) {
      const tokens = tokensOf(state.selector);
      const ground = tokens['map-bg']!;
      const best = Math.max(
        contrast(tokens['marker-halo']!, ground),
        contrast(tokens['marker-outline']!, ground),
      );
      expect([state.name, best >= 4.5]).toEqual([state.name, true]);
    }
  });

  it('styles the swatch ring through the same tokens, so a theme switch needs no rebuild', () => {
    expect(CSS).toMatch(/\.deposit-swatch__halo\s*\{\s*fill:\s*var\(--marker-halo\);/);
    expect(CSS).toMatch(/\.deposit-swatch__outline\s*\{\s*fill:\s*var\(--marker-outline\);/);
    const swatchRules = [...CSS.matchAll(/\.deposit-swatch[^{]*\{[^}]*\}/g)].map((m) => m[0]);
    expect(swatchRules.length).toBeGreaterThan(0);
    for (const rule of swatchRules) expect(rule).not.toMatch(/border-radius/);
  });
});

/** Every kind the ore filter can list for a profile, over all its dimensions. */
function kindsOf(profile: ProfileId): string[] {
  const descriptor = listProfiles().find((p) => p.id === profile);
  const ids = new Set<string>(descriptor?.depositOres ?? []);
  for (const list of Object.values(descriptor?.dimensionDepositOres ?? {}))
    for (const id of list ?? []) ids.add(id);
  return [...ids].sort();
}

const PROFILES: readonly ProfileId[] = ['tfc-1.20', 'tfg'];

describe('the ore filter swatch', () => {
  it('lists kinds for both profiles', () => {
    for (const profile of PROFILES)
      expect([profile, kindsOf(profile).length > 10]).toEqual([profile, true]);
  });

  it('gives every kind the shape and fill depositStyle gives it, on the painter’s outline', () => {
    for (const profile of PROFILES) {
      for (const id of kindsOf(profile)) {
        const style = depositStyle(profile, id);
        const spec = depositSwatchSpec(profile, id);
        expect([profile, id, spec.shape, spec.fill]).toEqual([
          profile,
          id,
          style.shape,
          colorToCss(style.color),
        ]);
        expect(spec.layers.map((l) => l.layer)).toEqual([...DEPOSIT_MARKER_LAYERS]);
        for (const { layer, d } of spec.layers)
          expect(d).toBe(depositMarkerPathData(style.shape, layer));
      }
    }
  });

  it('holds the whole marker, halo included, at 1:1 and on the map’s pixel phase', () => {
    for (const shape of DEPOSIT_SHAPES) {
      const [x, y, w, h] = depositSwatchViewBox(shape).split(' ').map(Number) as [
        number,
        number,
        number,
        number,
      ];
      expect([shape, w, h]).toEqual([shape, DEPOSIT_SWATCH_PX, DEPOSIT_SWATCH_PX]);
      const halo = bounds(outlinePoints(trace(shape, 'halo')));
      expect([
        shape,
        -halo.left >= x,
        -halo.top >= y,
        halo.right <= x + w,
        halo.bottom <= y + h,
      ]).toEqual([shape, true, true, true, true]);
      // The point lands where `snapMarkerCoordinate` puts it on the canvas: a whole-pixel box puts
      // the origin `-x` px in, which must sit at the same place within a pixel.
      expect([shape, snapMarkerCoordinate(shape, -x)]).toEqual([shape, -x]);
      expect([shape, snapMarkerCoordinate(shape, -y)]).toEqual([shape, -y]);
    }
  });
});

/** Records each fill: its style and the path it filled. */
interface FillEvent {
  readonly style: string;
  readonly traced: Traced;
}

function recordingCtx(fills: FillEvent[]): CanvasRenderingContext2D {
  let current: Traced = { points: [], radius: null, centre: null, closed: false };
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {
      current = { points: [], radius: null, centre: null, closed: false };
    },
    moveTo: (x: number, y: number) => {
      current.points.push(x, y);
    },
    lineTo: (x: number, y: number) => {
      current.points.push(x, y);
    },
    arc: (x: number, y: number, radius: number) => {
      current.points.length = 0;
      current.radius = radius;
      current.centre = [x, y];
    },
    closePath: () => {
      current.closed = true;
    },
    fill: () => {
      fills.push({ style: ctx.fillStyle, traced: current });
    },
    stroke: () => {},
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

const NO_TILES = {
  ensureVisible: () => {},
  getCachedTiles: (): CachedTile[] => [],
  getTile: () => undefined,
  pendingLayers: () => [],
  refine: () => {},
} as unknown as TileManager;

describe('the map marker and its swatch agree', () => {
  const camera = { centerX: 1000, centerZ: 2000, zoom: 0 };
  const halo = 0xfcfbf7;
  const outline = 0x1d1a14;

  function paintOne(
    profile: ProfileId,
    ore: string,
    x: number,
    z: number,
    withProfile = true,
  ): FillEvent[] {
    const fills: FillEvent[] = [];
    paintFrame({
      ctx: recordingCtx(fills),
      width: 200,
      height: 100,
      camera,
      layers: [],
      showGrid: false,
      tiles: NO_TILES,
      palette: { 'map-bg': 0xdedad0, 'marker-halo': halo, 'marker-outline': outline },
      ...(withProfile ? { profile } : {}),
      showDeposits: true,
      deposits: [{ ore, x, z } as unknown as DepositFeature],
    });
    return fills;
  }

  it('paints halo, outline and fill, in that order, in the swatch’s colours and on its outline', () => {
    let checked = 0;
    for (const profile of PROFILES) {
      const kinds = kindsOf(profile);
      for (const shape of DEPOSIT_SHAPES) {
        const id = kinds.find((kind) => depositStyle(profile, kind).shape === shape);
        if (id === undefined) continue;
        const spec = depositSwatchSpec(profile, id);
        // The painter is handed the namespaced id, as the generators emit it.
        const fills = paintOne(
          profile,
          `${profile === 'tfg' ? 'tfg' : 'tfc'}:${id}`,
          1003.3,
          2001.7,
        );
        expect(fills.map((f) => f.style)).toEqual([
          colorToCss(halo),
          colorToCss(outline),
          spec.fill,
        ]);
        const cx = snapMarkerCoordinate(shape, 100 + 3.3);
        const cy = snapMarkerCoordinate(shape, 50 + 1.7);
        DEPOSIT_MARKER_LAYERS.forEach((layer, index) => {
          const painted = fills[index]!.traced;
          const numbers = pathNumbers(spec.layers[index]!.d);
          if (painted.radius !== null) {
            expect(painted.centre).toEqual([cx, cy]);
            expect(painted.radius).toBeCloseTo(numbers[0]!, 2);
          } else {
            expect(painted.points.length).toBe(numbers.length);
            painted.points.forEach((value, i) =>
              expect(value - (i % 2 === 0 ? cx : cy)).toBeCloseTo(numbers[i]!, 2),
            );
          }
          expect([layer, painted.closed]).toEqual([layer, true]);
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('draws no marker without a profile, rather than guess which palette applies', () => {
    expect(paintOne('tfg', 'tfg:normal_copper', 1000, 2000, false)).toEqual([]);
  });
});

/** A sprite as the atlas drew it: where its cell starts, and its three fills. */
interface SpriteRecord {
  readonly cellX: number;
  readonly cellY: number;
  readonly scale: number;
  readonly fills: FillEvent[];
}

/** An OffscreenCanvas stand-in whose 2D context records each sprite the painter draws. */
function fakeOffscreenCanvas(sprites: SpriteRecord[]): unknown {
  return class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(): unknown {
      const inner: FillEvent[] = [];
      const ctx = recordingCtx(inner) as unknown as Record<string, unknown>;
      let sprite: SpriteRecord | null = null;
      ctx.setTransform = (a: number, _b: number, _c: number, _d: number, e: number, f: number) => {
        sprite = { cellX: e, cellY: f, scale: a, fills: [] };
        sprites.push(sprite);
      };
      ctx.clearRect = () => {};
      const fill = ctx.fill as () => void;
      ctx.fill = () => {
        fill();
        const last = inner.at(-1);
        if (sprite && last) sprite.fills.push(last);
      };
      return ctx;
    }
  };
}

describe('the sprite atlas the map stamps markers from', () => {
  const camera = { centerX: 0, centerZ: 0, zoom: 0 };
  /** Pixel ratio 2, as map-canvas.ts sets the transform on a high-density screen. */
  const SCALE = 2;

  function paintWithAtlas(
    profile: ProfileId,
    deposits: readonly { ore: string; x: number; z: number }[],
    ring: { halo: number; outline: number },
  ): { sprites: SpriteRecord[]; stamps: number[][] } {
    const sprites: SpriteRecord[] = [];
    const stamps: number[][] = [];
    vi.stubGlobal('OffscreenCanvas', fakeOffscreenCanvas(sprites));
    try {
      const ctx = recordingCtx([]) as unknown as Record<string, unknown>;
      ctx.getTransform = () => ({ a: SCALE, b: 0, c: 0, d: SCALE, e: 0, f: 0 });
      ctx.drawImage = (...args: unknown[]) => {
        stamps.push(args.slice(1).map(Number));
      };
      paintFrame({
        ctx: ctx as unknown as CanvasRenderingContext2D,
        width: 400,
        height: 300,
        camera,
        layers: [],
        showGrid: false,
        tiles: NO_TILES,
        palette: { 'map-bg': 0x1b1d20, 'marker-halo': ring.halo, 'marker-outline': ring.outline },
        profile,
        showDeposits: true,
        deposits: deposits as unknown as DepositFeature[],
      });
    } finally {
      vi.unstubAllGlobals();
    }
    return { sprites, stamps };
  }

  it('stamps each marker from a sprite of its own shape, fill and ring, its point on the deposit', () => {
    const ring = { halo: 0xf0f0e0, outline: 0x101010 };
    const kinds = kindsOf('tfg');
    const picks = DEPOSIT_SHAPES.map((shape) =>
      kinds.find((id) => depositStyle('tfg', id).shape === shape),
    ).filter((id): id is string => id !== undefined);
    expect(picks.length).toBeGreaterThan(0);
    // Off the pixel grid on purpose, so the stamp has to snap.
    const deposits = picks.map((id, i) => ({
      ore: `tfg:${id}`,
      x: -150.3 + i * 61.7,
      z: 20.6 - i * 13.1,
    }));
    const { sprites, stamps } = paintWithAtlas('tfg', deposits, ring);
    expect(stamps.length).toBe(deposits.length);
    deposits.forEach((deposit, index) => {
      const id = picks[index]!;
      const style = depositStyle('tfg', id);
      const [sx, sy, sw, sh, dx, dy, dw, dh] = stamps[index]!;
      const sprite = sprites.find((s) => s.cellX === sx && s.cellY === sy && s.fills.length > 0);
      expect([id, sprite !== undefined]).toEqual([id, true]);
      expect([sw, sh, dw, dh]).toEqual([sw, sw, sw! / SCALE, sw! / SCALE]);
      expect(sprite!.scale).toBe(SCALE);
      expect(sprite!.fills.map((f) => f.style)).toEqual([
        colorToCss(ring.halo),
        colorToCss(ring.outline),
        depositSwatchSpec('tfg', id).fill,
      ]);
      // The sprite's point, CSS px into its cell: where its fill was traced, against the geometry.
      const fill = sprite!.fills[2]!.traced;
      const origin = trace(style.shape, 'fill');
      const pointX = fill.centre ? fill.centre[0] : fill.points[0]! - origin.points[0]!;
      const pointY = fill.centre ? fill.centre[1] : fill.points[1]! - origin.points[1]!;
      sprite!.fills.forEach((f, layer) => {
        const expected = outlinePoints(
          trace(style.shape, DEPOSIT_MARKER_LAYERS[layer]!, pointX, pointY),
        );
        outlinePoints(f.traced).forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9));
      });
      // Stamped on whole device pixels, and the point lands within half a device pixel of the deposit.
      expect(Number.isInteger(Number((dx! * SCALE).toFixed(9)))).toBe(true);
      expect(Number.isInteger(Number((dy! * SCALE).toFixed(9)))).toBe(true);
      const screenX = 200 + deposit.x;
      const screenY = 150 + deposit.z;
      expect(Math.abs(dx! + pointX - screenX)).toBeLessThanOrEqual(0.5 / SCALE + 1e-9);
      expect(Math.abs(dy! + pointY - screenY)).toBeLessThanOrEqual(0.5 / SCALE + 1e-9);
    });
  });

  it('draws each sprite once, however many markers use it, and anew when the ring changes', () => {
    const id = kindsOf('tfg')[0]!;
    const many = Array.from({ length: 5 }, (_, i) => ({ ore: `tfg:${id}`, x: i * 20, z: 0 }));
    const first = paintWithAtlas('tfg', many, { halo: 0xe0e0e0, outline: 0x202020 });
    expect(first.stamps.length).toBe(5);
    expect(first.sprites.filter((s) => s.fills.length > 0).length).toBe(1);
    // Another theme: new ring colours, so a new atlas with sprites in those colours.
    const second = paintWithAtlas('tfg', many, { halo: 0xd0d0d0, outline: 0x303030 });
    const drawn = second.sprites.filter((s) => s.fills.length > 0);
    expect(drawn.length).toBe(1);
    expect(drawn[0]!.fills.map((f) => f.style).slice(0, 2)).toEqual([
      colorToCss(0xd0d0d0),
      colorToCss(0x303030),
    ]);
  });
});
