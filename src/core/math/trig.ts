/** Minecraft 1.20.1 Mth.sin/cos: float-indexed lookup, not direct Math.sin/cos.
 * Checked against the actual server classes by the Minecraft RNG fixture.
 */
const SIN = Float32Array.from({ length: 65536 }, (_, i) => Math.sin(i * Math.PI * 2 / 65536));

export function mthSin(angle: number): number {
  return SIN[(Math.fround(Math.fround(angle) * Math.fround(10430.378)) | 0) & 65535]!;
}

export function mthCos(angle: number): number {
  return SIN[(Math.fround(Math.fround(Math.fround(angle) * Math.fround(10430.378)) + 16384) | 0) & 65535]!;
}
