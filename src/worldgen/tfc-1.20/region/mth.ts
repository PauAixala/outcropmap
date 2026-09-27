/**
 * A tiny slice of `net.minecraft.util.Mth` — vanilla's math utility class — that `AnnotateClimate`
 * needs: `lerp(float, float, float)` and `clampedMap(float, float, float, float, float)`.
 *
 * @unverified against real Mojang source, same provenance category as `@core/random/xoroshiro`'s
 * `RandomSupport` constants: this project has no decompiled Minecraft source to check against
 * (CLAUDE.md section 8), so these are reimplementations of Mojang's extremely well-documented public
 * utility formulas — `lerp` and `clampedMap` are quoted identically across years of independent
 * modding documentation and source mirrors — not a guess and not a copy of any single one of them.
 * `clampedMap(value, oldMin, oldMax, newMin, newMax) = lerp(clamp((value-oldMin)/(oldMax-oldMin), 0,
 * 1), newMin, newMax)`. `tools/parity/capture-tfc-climate.mjs` independently arrived at the exact
 * same formula as its compile-time shim for the real `AnnotateClimate.java` — see
 * `tests/fixtures/tfc-1.20/climate-components.json`'s `"correction"` cases and
 * `tests/parity/tfc-1.20-climate.parity.test.ts`, which check this file's output against them.
 *
 * Float precision matters here: Java's `float op float` never promotes to `double`, so each binary
 * operation below is rounded with `Math.fround` individually (CLAUDE.md section 2), not just once
 * at the end — `point.temperature`/`point.rainfall` and `distanceToEdge`/`distanceToOcean` are all
 * `float`/`byte` in Java, so every intermediate here is float-exact, matching the fixture bit-for-bit
 * rather than merely approximately.
 */

const f = Math.fround;

/** `Mth.lerp(float delta, float start, float end)`. */
export function mthLerp(delta: number, start: number, end: number): number {
  const diff = f(end - start);
  const scaled = f(delta * diff);
  return f(start + scaled);
}

/** `Mth.inverseLerp(float value, float start, float end)` (unclamped). */
function mthInverseLerp(value: number, start: number, end: number): number {
  const num = f(value - start);
  const den = f(end - start);
  return f(num / den);
}

/** `Mth.clampedMap(float value, float oldMin, float oldMax, float newMin, float newMax)`. */
export function mthClampedMap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  const t = f(Math.min(1, Math.max(0, mthInverseLerp(value, oldMin, oldMax))));
  return mthLerp(t, newMin, newMax);
}
