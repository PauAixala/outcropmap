/**
 * OKLab, Björn Ottosson's perceptual colour space: "A perceptual color space for image processing"
 * (2020), https://bottosson.github.io/posts/oklab/. The matrices below are the ones that post gives
 * for linear sRGB (D65), to the published precision.
 *
 * Used to measure how far apart two map colours look: Euclidean distance in OKLab (ΔE_OK) is close
 * to perceptual difference, which RGB distance is not. Pure maths, no DOM; this module imports
 * nothing so that `tools/ore-palettes.mjs` can load it directly under Node's type stripping.
 *
 * Conventions: channels are 0..1 floats; "linear" means linear-light sRGB, "sRGB" means the gamma
 * encoded values a hex colour holds. Every function takes an optional `out` so a hot loop can reuse
 * one object instead of allocating per call.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

/** The sRGB transfer function, encoded 0..1 -> linear 0..1 (IEC 61966-2-1). */
export function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** The inverse transfer function, linear 0..1 -> encoded 0..1. */
export function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/** Linear sRGB -> OKLab (Ottosson's `linear_srgb_to_oklab`). */
export function linearRgbToOklab(r: number, g: number, b: number, out?: Oklab): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const target = out ?? { L: 0, a: 0, b: 0 };
  target.L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  target.a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  target.b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return target;
}

/** OKLab -> linear sRGB (Ottosson's `oklab_to_linear_srgb`). Not clamped: a result outside 0..1
 * means the colour is outside the sRGB gamut. */
export function oklabToLinearRgb(L: number, a: number, b: number, out?: Rgb): Rgb {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  const target = out ?? { r: 0, g: 0, b: 0 };
  target.r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  target.g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  target.b = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  return target;
}

/** A packed 0xRRGGBB colour as linear sRGB. */
export function packedToLinearRgb(color: number, out?: Rgb): Rgb {
  const target = out ?? { r: 0, g: 0, b: 0 };
  target.r = srgbToLinear(((color >> 16) & 0xff) / 255);
  target.g = srgbToLinear(((color >> 8) & 0xff) / 255);
  target.b = srgbToLinear((color & 0xff) / 255);
  return target;
}

/** A packed 0xRRGGBB colour in OKLab. */
export function packedToOklab(color: number, out?: Oklab): Oklab {
  const r = srgbToLinear(((color >> 16) & 0xff) / 255);
  const g = srgbToLinear(((color >> 8) & 0xff) / 255);
  const b = srgbToLinear((color & 0xff) / 255);
  return linearRgbToOklab(r, g, b, out);
}

/** Linear sRGB, clamped to the gamut and rounded to 8 bits per channel, packed 0xRRGGBB. */
export function linearRgbToPacked(r: number, g: number, b: number): number {
  const byte = (channel: number): number =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, channel))))) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/** Euclidean distance in OKLab, ΔE_OK. 0.02 is about a just-noticeable difference. */
export function oklabDistance(p: Oklab, q: Oklab): number {
  const dL = p.L - q.L;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** OKLab chroma, the distance from the neutral axis. */
export function oklabChroma(p: Oklab): number {
  return Math.sqrt(p.a * p.a + p.b * p.b);
}
