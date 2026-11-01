/**
 * Colour vision deficiency simulation: Machado, Oliveira and Fernandes, "A Physiologically-based
 * Model for Simulation of Color Vision Deficiency", IEEE Transactions on Visualization and Computer
 * Graphics 15(6), 2009, pp. 1291-1298. The matrices are the paper's severity-1.0 entries (its
 * Table 1, also published at https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/
 * CVD_Simulation.html), applied to **linear** sRGB as the model intends, then clamped to the gamut.
 *
 * Used to check that marker colours stay apart for the roughly 1 in 12 men with red-green colour
 * blindness: protanopia and deuteranopia collapse the red-green axis, so two fills that differ only
 * there look the same. Pure maths, no DOM, no imports (see `./oklab.ts` for why).
 */

export type CvdKind = 'protanopia' | 'deuteranopia' | 'tritanopia';

/** Row-major 3x3 matrices, linear RGB in -> linear RGB out, severity 1.0. */
export const MACHADO_2009: Readonly<Record<CvdKind, readonly number[]>> = {
  protanopia: [
    0.152286, 1.052583, -0.204868,
    0.114503, 0.786281, 0.099216,
    -0.003882, -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968,
    0.280085, 0.672501, 0.047413,
    -0.01182, 0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779,
    -0.078411, 0.930809, 0.147602,
    0.004733, 0.691367, 0.3039,
  ],
};

export interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** How a linear sRGB colour looks to someone with `kind` at full severity, as linear sRGB. */
export function simulateCvd(
  kind: CvdKind,
  r: number,
  g: number,
  b: number,
  out?: LinearRgb,
): LinearRgb {
  const m = MACHADO_2009[kind];
  const target = out ?? { r: 0, g: 0, b: 0 };
  target.r = clamp01(m[0]! * r + m[1]! * g + m[2]! * b);
  target.g = clamp01(m[3]! * r + m[4]! * g + m[5]! * b);
  target.b = clamp01(m[6]! * r + m[7]! * g + m[8]! * b);
  return target;
}
