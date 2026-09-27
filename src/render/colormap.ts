// Colour ramps and categorical palettes, resolved from theme tokens. Never hardcode hex here.

/** Packed 0xRRGGBB to a CSS colour string — shared by the canvas painter and the legend UI so both
 * render the exact same theme-resolved colour. */
export function colorToCss(color: number, alpha = 1): string {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function packRGB(r: number, g: number, b: number): number {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function unpackRGB(color: number): { r: number; g: number; b: number } {
  return { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff };
}

/** Linearly interpolates two packed 0xRRGGBB colours. */
export function lerpColor(a: number, b: number, t: number): number {
  const ca = unpackRGB(a);
  const cb = unpackRGB(b);
  const clamped = Math.min(1, Math.max(0, t));
  return packRGB(
    Math.round(ca.r + (cb.r - ca.r) * clamped),
    Math.round(ca.g + (cb.g - ca.g) * clamped),
    Math.round(ca.b + (cb.b - ca.b) * clamped),
  );
}

/** A continuous ramp between two theme-derived colours, for fields like temperature/rainfall. */
export function sequentialColor(t: number, low: number, high: number): number {
  return lerpColor(low, high, t);
}

/**
 * Samples a multi-stop colour ramp at a given value. Finds the bracketing stops and
 * interpolates between them; clamps to the nearest stop outside the range. Allocation-free.
 * The stops array must be sorted by value in ascending order.
 */
export function sampleRamp(stops: ReadonlyArray<{ value: number; color: number }>, value: number): number {
  if (stops.length === 0) return 0;
  if (stops.length === 1) return stops[0]!.color;

  // Find the bracketing stops
  if (value <= stops[0]!.value) return stops[0]!.color;
  if (value >= stops[stops.length - 1]!.value) return stops[stops.length - 1]!.color;

  for (let i = 0; i < stops.length - 1; i++) {
    const lower = stops[i]!;
    const upper = stops[i + 1]!;
    if (value >= lower.value && value <= upper.value) {
      const range = upper.value - lower.value;
      const t = range === 0 ? 0 : (value - lower.value) / range;
      return lerpColor(lower.color, upper.color, t);
    }
  }

  // Should not reach here if stops are sorted
  return stops[stops.length - 1]!.color;
}

function hslToRgbPacked(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  return packRGB(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

/**
 * A deterministic, procedural categorical colour for an arbitrary integer key — used where a real
 * per-category palette does not exist yet (e.g. the Phase 1 debug generator's fake biomes/rocks).
 * Not a hardcoded palette: every colour is derived from the key by formula.
 */
export function categoricalColor(key: number): number {
  const hue = Math.abs(key * 2654435761) % 360;
  return hslToRgbPacked(hue, 0.55, 0.55);
}

/** FNV-1a style string hash, for turning a category name into a stable integer key. */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
