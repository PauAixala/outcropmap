/**
 * Deposit markers on the `minerals` layer: the geometry the canvas painter draws and the ore
 * filter's swatches show, kept in one place so the two cannot disagree (docs/DESIGN.md section 6:
 * one source per glyph, so what the player picks in the list is what lands on the map). Also the
 * ore filter's predicate.
 *
 * A marker is three nested layers, painted outermost first:
 * - the halo, in `--marker-halo`, light in both themes;
 * - the outline, in `--marker-outline`, dark in both themes;
 * - the fill, in the colour and shape `depositStyle` gives the kind (theme-independent).
 *
 * One band of the ring is light and the other dark, so whatever lies under a marker (the light map,
 * the dark map, any raster layer) one of the two stands out from it, and the dark band separates a
 * light fill from the light halo. Our own UI design (docs/PLAN.md 20.1, 2026-11-01), not a port.
 *
 * Every size is in CSS pixels and constant at every zoom: a marker says where a vein is, not how big
 * it is (its real size is in the click readout). Pure and DOM-free, so tests can measure it.
 */
import { colorToCss } from '@render/colormap';
import type { DepositShape } from '@render/deposit-style';
import { depositStyle } from '@render/deposit-style';
import type { ProfileId } from '@worldgen/api/types';

/** Every shape a marker can take, in `DepositShape`'s order. */
export const DEPOSIT_SHAPES: readonly DepositShape[] = ['circle', 'diamond', 'square', 'triangle'];

/**
 * The size each fill is built from, CSS px. The areas match the 5 px circle the map drew before
 * shapes (78.5 px²) to within 10%, so no category looks more important than another:
 * - circle: the radius, 5; area 78.5;
 * - square: half its 9 px side; area 81;
 * - diamond: from the point to each tip, 6; area 72 (a diamond looks larger than a square of the
 *   same area, so it takes the low side);
 * - triangle: equilateral and point up, centred on its centroid, 4 px from the centroid to each
 *   side, so its tips are 8 px out; area 83.1.
 */
export const DEPOSIT_FILL_SIZE_PX: Readonly<Record<DepositShape, number>> = {
  circle: 5,
  diamond: 6,
  square: 4.5,
  triangle: 4,
};

/** Width of the dark band around the fill, CSS px. */
export const DEPOSIT_OUTLINE_PX = 1;
/** Width of the light band around the outline, CSS px. */
export const DEPOSIT_HALO_PX = 1;

/**
 * Where a marker's point sits within a pixel. Whole-pixel ring widths keep every horizontal and
 * vertical edge on a pixel boundary at device-pixel ratios 1 and 2, so the square and the
 * triangle's base stay crisp: the 9 px square needs its centre on a pixel centre (0.5), the
 * triangle its centroid on a pixel corner (0). The circle and the diamond have no straight
 * axis-aligned edge and take a pixel centre, which keeps them symmetric.
 */
export const DEPOSIT_PIXEL_PHASE: Readonly<Record<DepositShape, number>> = {
  circle: 0.5,
  diamond: 0.5,
  square: 0.5,
  triangle: 0,
};

/**
 * Screen distance within which a click selects a marker. It covers every shape whole, halo
 * included (the triangle's tips reach exactly this far), so a click anywhere on a marker lands.
 */
export const DEPOSIT_HIT_RADIUS_PX = 12;

/** The three layers of a marker, in paint order: each covers the middle of the one before. */
export type DepositMarkerLayer = 'halo' | 'outline' | 'fill';
export const DEPOSIT_MARKER_LAYERS: readonly DepositMarkerLayer[] = ['halo', 'outline', 'fill'];

/** How far each layer's edge sits outside the fill's. */
const LAYER_GROWTH: Readonly<Record<DepositMarkerLayer, number>> = {
  fill: 0,
  outline: DEPOSIT_OUTLINE_PX,
  halo: DEPOSIT_OUTLINE_PX + DEPOSIT_HALO_PX,
};

/** One layer's outline, centred on the deposit's point: a circle, or a convex polygon. */
export interface DepositOutline {
  /** The circle's radius; 0 for a polygon. */
  readonly radius: number;
  /** A polygon's vertices as x0, y0, x1, y1, ... (y down, clockwise on screen); empty for a circle. */
  readonly points: readonly number[];
}

function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

/** Each polygon's fill vertices. */
function fillPolygon(shape: Exclude<DepositShape, 'circle'>): number[] {
  const size = DEPOSIT_FILL_SIZE_PX[shape];
  switch (shape) {
    case 'square':
      return [-size, -size, size, -size, size, size, -size, size];
    case 'diamond':
      return [0, -size, size, 0, 0, size, -size, 0];
    case 'triangle': {
      // Equilateral around its centroid: the vertices are twice the inradius out.
      const tip = 2 * size;
      return [0, -tip, tip * Math.sin(Math.PI / 3), tip / 2, -tip * Math.sin(Math.PI / 3), tip / 2];
    }
  }
}

/**
 * A convex polygon grown outward by `distance`, with mitred corners: every edge moves out along its
 * normal, and each corner is where two neighbouring edges meet once moved. It is the outline a
 * mitre-joined stroke of width `2 * distance` traces, as a path that can be filled.
 */
export function growPolygon(points: readonly number[], distance: number): number[] {
  const count = points.length / 2;
  let twiceArea = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    twiceArea +=
      at(points, 2 * i) * at(points, 2 * j + 1) - at(points, 2 * j) * at(points, 2 * i + 1);
  }
  // Normals point outward whichever way round the polygon is listed.
  const sign = twiceArea >= 0 ? 1 : -1;
  const normals: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ex = at(points, 2 * j) - at(points, 2 * i);
    const ey = at(points, 2 * j + 1) - at(points, 2 * i + 1);
    const length = Math.hypot(ex, ey);
    normals.push((sign * ey) / length, (-sign * ex) / length);
  }
  const grown: number[] = [];
  for (let i = 0; i < count; i++) {
    const previous = (i + count - 1) % count;
    const ax = at(normals, 2 * previous);
    const ay = at(normals, 2 * previous + 1);
    const bx = at(normals, 2 * i);
    const by = at(normals, 2 * i + 1);
    // The corner moves along the sum of the two normals until it sits `distance` from both edges.
    const scale = distance / (1 + ax * bx + ay * by);
    grown.push(at(points, 2 * i) + (ax + bx) * scale, at(points, 2 * i + 1) + (ay + by) * scale);
  }
  return grown;
}

function outlineFor(shape: DepositShape, layer: DepositMarkerLayer): DepositOutline {
  const growth = LAYER_GROWTH[layer];
  if (shape === 'circle') return { radius: DEPOSIT_FILL_SIZE_PX.circle + growth, points: [] };
  return { radius: 0, points: growPolygon(fillPolygon(shape), growth) };
}

function layersFor(shape: DepositShape): Readonly<Record<DepositMarkerLayer, DepositOutline>> {
  return {
    halo: outlineFor(shape, 'halo'),
    outline: outlineFor(shape, 'outline'),
    fill: outlineFor(shape, 'fill'),
  };
}

/** Every layer of every shape, computed once at load. */
export const DEPOSIT_MARKER_GEOMETRY: Readonly<
  Record<DepositShape, Readonly<Record<DepositMarkerLayer, DepositOutline>>>
> = {
  circle: layersFor('circle'),
  diamond: layersFor('diamond'),
  square: layersFor('square'),
  triangle: layersFor('triangle'),
};

/** The subset of CanvasRenderingContext2D (and of Path2D) a marker is traced with. */
export interface MarkerPathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  closePath(): void;
}

/**
 * Traces one layer of a marker centred on `(cx, cy)` into an empty path: the caller begins the
 * path and fills it. Allocates nothing.
 *
 * A circle is a bare `arc`, with no `moveTo` before it. That leaves the path a plain oval, which
 * Chrome's GPU rasteriser draws cleanly; a `moveTo`-led arc came out with a one-pixel notch at the
 * bottom of the ring at some positions (measured 2026-11-01). On an empty path the arc starts its
 * own subpath, so the path is the same.
 */
export function traceDepositMarker(
  path: MarkerPathSink,
  shape: DepositShape,
  layer: DepositMarkerLayer,
  cx: number,
  cy: number,
): void {
  const outline = DEPOSIT_MARKER_GEOMETRY[shape][layer];
  const points = outline.points;
  if (points.length === 0) {
    path.arc(cx, cy, outline.radius, 0, Math.PI * 2);
  } else {
    path.moveTo(cx + at(points, 0), cy + at(points, 1));
    for (let i = 2; i < points.length; i += 2) {
      path.lineTo(cx + at(points, i), cy + at(points, i + 1));
    }
  }
  path.closePath();
}

/** Snaps a screen coordinate to where the shape's point belongs within a pixel (`DEPOSIT_PIXEL_PHASE`). */
export function snapMarkerCoordinate(shape: DepositShape, value: number): number {
  const phase = DEPOSIT_PIXEL_PHASE[shape];
  return Math.round(value - phase) + phase;
}

/** A layer's bounding box around the deposit's point, CSS px. */
export function depositMarkerBounds(
  shape: DepositShape,
  layer: DepositMarkerLayer = 'halo',
): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } {
  const outline = DEPOSIT_MARKER_GEOMETRY[shape][layer];
  if (outline.points.length === 0) {
    return {
      minX: -outline.radius,
      minY: -outline.radius,
      maxX: outline.radius,
      maxY: outline.radius,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < outline.points.length; i += 2) {
    const x = at(outline.points, i);
    const y = at(outline.points, i + 1);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** The farthest any layer of any shape reaches from its point along x or y: the painter's cull margin. */
export const DEPOSIT_MARKER_REACH_PX = Math.max(
  ...DEPOSIT_SHAPES.map((shape) => {
    const box = depositMarkerBounds(shape, 'halo');
    return Math.max(-box.minX, -box.minY, box.maxX, box.maxY);
  }),
);

/** A number for SVG path data: three decimals, no trailing zeros, never `-0`. */
function svgNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded === 0 ? 0 : rounded);
}

/** One layer as SVG path data, centred on the origin: the same outline `traceDepositMarker` draws. */
export function depositMarkerPathData(shape: DepositShape, layer: DepositMarkerLayer): string {
  const outline = DEPOSIT_MARKER_GEOMETRY[shape][layer];
  if (outline.points.length === 0) {
    const r = svgNumber(outline.radius);
    const negative = svgNumber(-outline.radius);
    return `M${r} 0A${r} ${r} 0 1 1 ${negative} 0A${r} ${r} 0 1 1 ${r} 0Z`;
  }
  let d = '';
  for (let i = 0; i < outline.points.length; i += 2) {
    d += `${i === 0 ? 'M' : 'L'}${svgNumber(at(outline.points, i))} ${svgNumber(at(outline.points, i + 1))}`;
  }
  return `${d}Z`;
}

/** Side of the ore filter's swatch, CSS px: the marker at 1:1, the triangle's halo included. */
export const DEPOSIT_SWATCH_PX = 24;

/**
 * The swatch's viewBox: the marker at 1:1 with its halo's box centred in the swatch, and the point
 * kept on the same pixel phase as on the map, so the swatch is the marker pixel for pixel.
 */
export function depositSwatchViewBox(shape: DepositShape): string {
  const box = depositMarkerBounds(shape, 'halo');
  const phase = DEPOSIT_PIXEL_PHASE[shape];
  const half = DEPOSIT_SWATCH_PX / 2;
  const originX = Math.round(half - (box.minX + box.maxX) / 2 - phase) + phase;
  const originY = Math.round(half - (box.minY + box.maxY) / 2 - phase) + phase;
  return `${svgNumber(-originX)} ${svgNumber(-originY)} ${DEPOSIT_SWATCH_PX} ${DEPOSIT_SWATCH_PX}`;
}

/** Everything the ore filter needs to draw one kind's swatch, without touching the DOM. */
export interface DepositSwatchSpec {
  readonly shape: DepositShape;
  /** The fill as CSS: `depositStyle`'s colour, the same in both themes. */
  readonly fill: string;
  readonly viewBox: string;
  /** Path data per layer, in paint order. The halo and outline take their colours from CSS. */
  readonly layers: readonly { readonly layer: DepositMarkerLayer; readonly d: string }[];
}

/** The swatch for one kind: the shape and fill the painter gives it, from the same `depositStyle`. */
export function depositSwatchSpec(profile: ProfileId, ore: string): DepositSwatchSpec {
  const style = depositStyle(profile, ore);
  return {
    shape: style.shape,
    fill: colorToCss(style.color),
    viewBox: depositSwatchViewBox(style.shape),
    layers: DEPOSIT_MARKER_LAYERS.map((layer) => ({
      layer,
      d: depositMarkerPathData(style.shape, layer),
    })),
  };
}

export function matchesOreFilter(ore: string, filter: readonly string[]): boolean {
  return filter.length === 0 || filter.includes(ore.replace(/^[^:]+:/, ''));
}
