/**
 * Waypoint glyph geometry — the single source both the DOM picker and the canvas marker draw from,
 * so what the user previews is exactly what lands on the map (docs/DESIGN.md section 6,
 * docs/PLAN.md 10c P1).
 *
 * Pure data, no DOM and no canvas: the SVG builder joins it into path data, the painter walks it
 * with `moveTo`/`lineTo`. That keeps this importable from a Node test and avoids `Path2D`, which
 * does not exist outside a browser.
 *
 * Every coordinate is an **integer on a 16x16 grid** (ADR 0008): the shapes are drawn from
 * rectangles and straight edges only, never curves or strokes, so they render identically as a flat
 * icon and as pixel art under `shape-rendering: crispEdges`. Render them at exactly 16 or 32 CSS px
 * — anything in between puts the grid off the device pixel and the anti-aliasing the direction
 * forbids comes straight back.
 *
 * Original artwork, drawn for this project. No game assets (AGENTS.md section 8).
 */
import type { WaypointIcon } from '@app/waypoints';

/** Width and height of the coordinate grid every glyph is drawn on. */
export const GLYPH_GRID = 16;

/**
 * One glyph: a list of closed subpaths, each a flat `[x0, y0, x1, y1, ...]` run of integer points.
 * A second subpath is either a separate piece (the pickaxe handle) or a hole (the gear centre) —
 * both fill correctly under the even-odd rule, which is what the consumers below apply.
 */
export type Glyph = readonly (readonly number[])[];

export const GLYPHS: Readonly<Record<WaypointIcon, Glyph>> = {
  house: [[8, 2, 15, 9, 13, 9, 13, 14, 10, 14, 10, 10, 6, 10, 6, 14, 3, 14, 3, 9, 1, 9]],
  mine: [
    [2, 7, 2, 5, 5, 3, 8, 4, 11, 3, 14, 5, 14, 7, 11, 5, 8, 6, 5, 5],
    [7, 6, 9, 6, 9, 15, 7, 15],
  ],
  portal: [
    [2, 15, 2, 5, 5, 2, 11, 2, 14, 5, 14, 15, 11, 15, 11, 6, 9, 5, 7, 5, 5, 6, 5, 15],
    [7, 8, 9, 8, 9, 13, 7, 13],
  ],
  flag: [
    [3, 1, 5, 1, 5, 15, 3, 15],
    [5, 2, 14, 2, 11, 5, 14, 8, 5, 8],
  ],
  star: [[8, 1, 10, 6, 15, 6, 11, 9, 13, 15, 8, 11, 3, 15, 5, 9, 1, 6, 6, 6]],
  question: [
    [
      4, 6, 4, 4, 6, 3, 10, 3, 12, 4, 12, 8, 10, 9, 9, 10, 9, 12, 7, 12, 7, 9, 8, 8, 10, 7, 10, 5,
      6, 5, 6, 6,
    ],
    [7, 13, 9, 13, 9, 15, 7, 15],
  ],
};

export const PANEL_GLYPHS = {
  waypoints: [
    [8, 1, 13, 6, 8, 15, 3, 6],
    [7, 5, 9, 5, 9, 7, 7, 7],
  ],
  layers: [
    [8, 1, 15, 5, 8, 9, 1, 5],
    [1, 8, 3, 7, 8, 10, 13, 7, 15, 8, 8, 12],
    [1, 11, 3, 10, 8, 13, 13, 10, 15, 11, 8, 15],
  ],
  filter: [[1, 2, 15, 2, 10, 8, 10, 14, 6, 12, 6, 8]],
  measure: [
    [2, 11, 11, 2, 14, 5, 5, 14],
    [5, 9, 6, 8, 7, 9, 6, 10],
    [8, 6, 9, 5, 10, 6, 9, 7],
  ],
  legend: [
    [2, 2, 7, 2, 7, 7, 2, 7],
    [9, 2, 14, 2, 14, 7, 9, 7],
    [2, 9, 7, 9, 7, 14, 2, 14],
    [9, 9, 14, 9, 14, 14, 9, 14],
  ],
  settings: [
    [2, 3, 14, 3, 14, 5, 2, 5],
    [5, 1, 7, 1, 7, 7, 5, 7],
    [2, 8, 14, 8, 14, 10, 2, 10],
    [9, 6, 11, 6, 11, 12, 9, 12],
    [2, 13, 14, 13, 14, 15, 2, 15],
  ],
  recipes: [
    [2, 2, 14, 2, 14, 14, 2, 14],
    [5, 5, 11, 5, 11, 7, 5, 7],
    [5, 9, 11, 9, 11, 11, 5, 11],
  ],
  customRecipe: [
    [2, 11, 10, 3, 13, 6, 5, 14],
    [10, 2, 14, 6, 12, 8, 8, 4],
  ],
  savedRecipes: [
    [2, 1, 12, 1, 15, 4, 15, 15, 2, 15],
    [5, 2, 10, 2, 10, 6, 5, 6],
    [5, 10, 12, 10, 12, 14, 5, 14],
  ],
} as const satisfies Readonly<Record<string, Glyph>>;

/** SVG `d` attribute for one glyph. Use with `fill-rule="evenodd"` and no stroke. */
export function glyphToPathData(glyph: Glyph): string {
  let d = '';
  for (const points of glyph) {
    for (let i = 0; i < points.length; i += 2) {
      d += `${i === 0 ? 'M' : 'L'}${points[i]} ${points[i + 1]}`;
    }
    d += 'Z';
  }
  return d;
}

export function createGlyphSvg(glyph: Glyph, className: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add(className);
  svg.setAttribute('viewBox', `0 0 ${GLYPH_GRID} ${GLYPH_GRID}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', glyphToPathData(glyph));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

/**
 * Traces one glyph into the current canvas path, scaled to `size` and centred on `(cx, cy)`.
 * The caller fills with `'evenodd'` — the even-odd rule is what turns a second subpath into a hole.
 */
export function traceGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: Glyph,
  cx: number,
  cy: number,
  size: number,
): void {
  const scale = size / GLYPH_GRID;
  const originX = cx - size / 2;
  const originY = cy - size / 2;
  ctx.beginPath();
  for (const points of glyph) {
    for (let i = 0; i < points.length; i += 2) {
      const x = originX + (points[i] ?? 0) * scale;
      const y = originY + (points[i + 1] ?? 0) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}
