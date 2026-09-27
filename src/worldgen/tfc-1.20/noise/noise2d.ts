/**
 * `net.dries007.tfc.world.noise.Noise2D`: a 2D noise function plus the fluent combinators TFC
 * chains to build its region-generator noise fields. Only the combinators actually used by the
 * climate-relevant fields (`RegionGenerator.temperatureNoise` / `rainfallNoise` /
 * `continentNoise`) are ported: `scaled`, `add`, `lazyProduct`. Generic, allocation-light — these
 * run per pixel inside worker tile rendering (CLAUDE.md section 6).
 */

/** `Noise2D.noise(double x, double z)`. */
export type Noise2D = (x: number, z: number) => number;

/**
 * `Noise2D.scaled(double oldMin, double oldMax, double min, double max)` (the 4-arg overload;
 * TFC only ever calls the 2-arg `scaled(min, max)`, which is `scaled(-1, 1, min, max)` — see
 * `RegionGenerator`'s `temperatureNoise`/`rainfallNoise` construction).
 */
export function scaled(noise: Noise2D, min: number, max: number, oldMin = -1, oldMax = 1): Noise2D {
  const scale = (max - min) / (oldMax - oldMin);
  const shift = min - oldMin * scale;
  return (x, z) => noise(x, z) * scale + shift;
}

/** `Noise2D.add(Noise2D other)`. */
export function add(a: Noise2D, b: Noise2D): Noise2D {
  return (x, z) => a(x, z) + b(x, z);
}

/** `Noise2D.lazyProduct(Noise2D other)`: skips evaluating `b` when `a` is exactly zero. */
export function lazyProduct(a: Noise2D, b: Noise2D): Noise2D {
  return (x, z) => {
    const value = a(x, z);
    return value === 0 ? 0 : value * b(x, z);
  };
}

/*
 * The remaining `Noise2D` default methods, ported for the surface-height work (plan section 9).
 * `BiomeNoise` chains these on top of a configured `OpenSimplex2D`, so the two layers are distinct:
 * `OpenSimplex2D.octaves/spread/scaled` mutate the FastNoiseLite configuration, while everything
 * below wraps an already-built function. Mixing them up changes the result silently — for example
 * `Noise2D.octaves` is an entirely different computation from `OpenSimplex2D.octaves`.
 */

/** `Noise2D.map(DoubleUnaryOperator)`. */
export function map(noise: Noise2D, fn: (value: number) => number): Noise2D {
  return (x, z) => fn(noise(x, z));
}

/** `Noise2D.affine(double scale, double shift)`. */
export function affine(noise: Noise2D, scale: number, shift: number): Noise2D {
  return (x, z) => noise(x, z) * scale + shift;
}

/** `Noise2D.abs()` — absolute value, deliberately *not* rescaled. */
/** `Noise2D.min(Noise2D)` — the lower of two fields at each point. */
export function min(a: Noise2D, b: Noise2D): Noise2D {
  return (x, z) => Math.min(a(x, z), b(x, z));
}

/** `Noise2D.max(Noise2D)` — the higher of two fields at each point. */
export function max(a: Noise2D, b: Noise2D): Noise2D {
  return (x, z) => Math.max(a(x, z), b(x, z));
}

export function abs(noise: Noise2D): Noise2D {
  return (x, z) => Math.abs(noise(x, z));
}

/** `Noise2D.ridged()`: `1 - 2 * |value|`, so the output flips to a ridge at every zero crossing. */
export function ridged(noise: Noise2D): Noise2D {
  return (x, z) => {
    const value = noise(x, z);
    return 1 - 2 * (value < 0 ? -value : value);
  };
}

/**
 * `Noise2D.terraces(int levels)`. Input must be in [-1, 1].
 *
 * The `(int)` cast truncates toward zero, which is *not* `Math.floor` for a negative input — but
 * the expression `0.5 * value + 0.5` maps [-1, 1] to [0, 1], so it is non-negative in practice and
 * `Math.trunc` is the faithful translation either way (CLAUDE.md section 2).
 */
export function terraces(noise: Noise2D, levels: number): Noise2D {
  return (x, z) => {
    const value = 0.5 * noise(x, z) + 0.5;
    const rounded = Math.trunc(value * levels);
    return (rounded * 2) / levels - 1;
  };
}

/** `Noise2D.clamped(double min, double max)`. */
export function clamped(noise: Noise2D, min: number, max: number): Noise2D {
  return (x, z) => {
    const value = noise(x, z);
    return value < min ? min : value > max ? max : value;
  };
}

/**
 * `Noise2D.octaves(int octaves)` — the **interface default**, which samples the same underlying
 * noise at `1 / 2^i` scale with amplitude `0.5^(octaves - i)`. This is not what
 * `OpenSimplex2D.octaves` does (that reconfigures FastNoiseLite's own fractal FBm); TFC uses both,
 * on different noises, and they are not interchangeable.
 */
export function octavesOf(noise: Noise2D, octaves: number): Noise2D {
  const frequency: number[] = [];
  const amplitude: number[] = [];
  for (let i = 0; i < octaves; i++) {
    frequency.push(1 << i);
    amplitude.push(Math.pow(Math.fround(0.5), octaves - i));
  }
  return (x, z) => {
    let value = 0;
    for (let i = 0; i < octaves; i++) {
      const freq = frequency[i] ?? 1;
      value += noise(x / freq, z / freq) * (amplitude[i] ?? 0);
    }
    return value;
  };
}

/** `Noise2D.spread(double scaleFactor)` — the interface default, scaling the *input*. */
export function spreadInput(noise: Noise2D, scaleFactor: number): Noise2D {
  return (x, z) => noise(x * scaleFactor, z * scaleFactor);
}

/** `Mth.clamp`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `Mth.lerp(delta, start, end)`. */
export function lerp(delta: number, start: number, end: number): number {
  return start + delta * (end - start);
}

/** `Mth.map(value, from0, from1, to0, to1)` — unclamped. */
export function mapRange(
  value: number,
  from0: number,
  from1: number,
  to0: number,
  to1: number,
): number {
  return to0 + ((value - from0) * (to1 - to0)) / (from1 - from0);
}

/** `Mth.clampedMap(value, from0, from1, to0, to1)`. */
export function clampedMap(
  value: number,
  from0: number,
  from1: number,
  to0: number,
  to1: number,
): number {
  return lerp(clamp((value - from0) / (from1 - from0), 0, 1), to0, to1);
}

/**
 * `Noise2D.warped(OpenSimplex2D warp)`: samples this noise at a position displaced by the warp.
 *
 * The Java reuses one mutable `Vector2` cursor across calls; this allocates a fresh object per
 * sample instead. That is a deliberate difference with no behavioural effect — the cursor is fully
 * overwritten before every use — and it keeps the function reentrant, which matters because these
 * noises are shared across a worker's columns.
 */
export function warped(
  noise: Noise2D,
  warp: { warpCursor(cursor: { x: number; y: number }): void },
): Noise2D {
  return (x, z) => {
    const cursor = { x, y: z };
    warp.warpCursor(cursor);
    return noise(cursor.x, cursor.y);
  };
}
