/**
 * Vanilla's density functions — the subset that the climate half of a `minecraft:noise` dimension
 * actually uses, compiled from the JSON `tools/extract-dimension-climate.mjs` writes into closures.
 *
 * `net.minecraft.world.level.levelgen.DensityFunctions`. Only the six climate parameters are
 * evaluated here, never terrain density, so the whole cave/aquifer/jaggedness half of that class is
 * deliberately absent: the extractor reports any type it meets that is not in `CHILDREN` there and
 * this file throws on any type it cannot evaluate, so an unported node is a loud failure rather
 * than a plausible zero.
 *
 * **The markers are pass-throughs, and that is not a shortcut.** `flat_cache`, `cache_2d`,
 * `cache_once` and `interpolated` are `DensityFunctions.Marker`, whose own `compute` is
 * `wrapped.compute(context)`. The caching (and, for `flat_cache`, the quart-aligned y=0 sampling)
 * exists only in the copies `NoiseChunk` builds for terrain generation. `Climate.Sampler`, which is
 * what a biome lookup uses, holds the unvisited router — so a marker here really does mean nothing.
 *
 * Likewise `blend_alpha` is 1 and `blend_offset` is 0 outside a `Blender`, which only exists when an
 * old chunk borders a new one.
 */
import { NormalNoise } from './noise/normal-noise';

/** The compiled form: block coordinates in, one double out. */
export type DensityFunction = (x: number, y: number, z: number) => number;

/** How a compiled function finds the noise a node names. Returning `null` is a hard error. */
export type NoiseLookup = (id: string) => NormalNoise | null;

interface SplinePoint {
  readonly location: number;
  readonly derivative: number;
  readonly value: SplineNode;
}
type SplineNode = number | { readonly coordinate: unknown; readonly points: readonly SplinePoint[] };

/** `Mth.clampedMap` — the ramp `y_clamped_gradient` is. */
function clampedMap(value: number, from: number, to: number, fromValue: number, toValue: number): number {
  if (value <= from) return fromValue;
  if (value >= to) return toValue;
  const t = (value - from) / (to - from);
  return fromValue + t * (toValue - fromValue);
}

function noiseOf(lookup: NoiseLookup, id: unknown, where: string): NormalNoise {
  if (typeof id !== 'string') throw new Error(`${where}: noise is not an id (${String(id)})`);
  const noise = lookup(id);
  if (noise === null) throw new Error(`${where}: no noise parameters for ${id}`);
  return noise;
}

/**
 * `CubicSpline.Multipoint#apply` — a piecewise cubic Hermite spline, extrapolated linearly past
 * either end. Vanilla computes it in `float`, and the rounding is visible in the result, so every
 * step goes through `Math.fround`.
 */
function compileSpline(node: SplineNode, lookup: NoiseLookup): DensityFunction {
  if (typeof node === 'number') {
    return () => node;
  }
  const coordinate = compile(node.coordinate, lookup);
  const locations = node.points.map((p) => Math.fround(p.location));
  const derivatives = node.points.map((p) => Math.fround(p.derivative));
  const values = node.points.map((p) => compileSpline(p.value, lookup));
  const last = locations.length - 1;
  if (last < 0) throw new Error('spline with no points');

  return (x, y, z) => {
    const f = Math.fround(coordinate(x, y, z));
    // The interval whose start is the last location at or below `f`; -1 means "before the first".
    let i = -1;
    while (i + 1 <= last && locations[i + 1]! <= f) i++;
    if (i < 0) {
      return Math.fround(values[0]!(x, y, z) + derivatives[0]! * (f - locations[0]!));
    }
    if (i === last) {
      return Math.fround(values[last]!(x, y, z) + derivatives[last]! * (f - locations[last]!));
    }
    const loc0 = locations[i]!;
    const loc1 = locations[i + 1]!;
    const span = Math.fround(loc1 - loc0);
    const t = Math.fround((f - loc0) / span);
    const v0 = Math.fround(values[i]!(x, y, z));
    const v1 = Math.fround(values[i + 1]!(x, y, z));
    const d0 = Math.fround(Math.fround(derivatives[i]! * span) - Math.fround(v1 - v0));
    const d1 = Math.fround(Math.fround(-derivatives[i + 1]! * span) + Math.fround(v1 - v0));
    const linear = Math.fround(v0 + Math.fround(t * Math.fround(v1 - v0)));
    const bend = Math.fround(d0 + Math.fround(t * Math.fround(d1 - d0)));
    return Math.fround(linear + Math.fround(Math.fround(t * Math.fround(1 - t)) * bend));
  };
}

/** Compiles one node of the extracted JSON. Throws on anything it cannot evaluate. */
export function compile(node: unknown, lookup: NoiseLookup): DensityFunction {
  if (typeof node === 'number') return () => node;
  if (node === null || typeof node !== 'object') {
    throw new Error(`not a density function: ${String(node)}`);
  }
  const n = node as Record<string, unknown>;
  const type = String(n['type']);
  const child = (key: string): DensityFunction => compile(n[key], lookup);

  switch (type) {
    case 'minecraft:constant': {
      const value = Number(n['argument']);
      return () => value;
    }
    case 'minecraft:blend_alpha':
      return () => 1;
    case 'minecraft:blend_offset':
      return () => 0;
    case 'minecraft:y_clamped_gradient': {
      const fromY = Number(n['from_y']);
      const toY = Number(n['to_y']);
      const fromValue = Number(n['from_value']);
      const toValue = Number(n['to_value']);
      return (_x, y) => clampedMap(y, fromY, toY, fromValue, toValue);
    }

    // Markers: transparent outside a NoiseChunk. See this file's header.
    case 'minecraft:flat_cache':
    case 'minecraft:cache_2d':
    case 'minecraft:cache_once':
    case 'minecraft:cache_all_in_cell':
    case 'minecraft:interpolated':
    case 'minecraft:blend_density':
      return child('argument');

    case 'minecraft:abs': {
      const a = child('argument');
      return (x, y, z) => Math.abs(a(x, y, z));
    }
    case 'minecraft:square': {
      const a = child('argument');
      return (x, y, z) => {
        const v = a(x, y, z);
        return v * v;
      };
    }
    case 'minecraft:cube': {
      const a = child('argument');
      return (x, y, z) => {
        const v = a(x, y, z);
        return v * v * v;
      };
    }
    case 'minecraft:half_negative': {
      const a = child('argument');
      return (x, y, z) => {
        const v = a(x, y, z);
        return v > 0 ? v : v * 0.5;
      };
    }
    case 'minecraft:quarter_negative': {
      const a = child('argument');
      return (x, y, z) => {
        const v = a(x, y, z);
        return v > 0 ? v : v * 0.25;
      };
    }
    case 'minecraft:squeeze': {
      const a = child('argument');
      return (x, y, z) => {
        const v = Math.max(-1, Math.min(1, a(x, y, z)));
        return v / 2 - (v * v * v) / 24;
      };
    }
    case 'minecraft:add': {
      const a = child('argument1');
      const b = child('argument2');
      return (x, y, z) => a(x, y, z) + b(x, y, z);
    }
    case 'minecraft:mul': {
      const a = child('argument1');
      const b = child('argument2');
      // Vanilla short-circuits a zero left operand; with pure functions that is only a saving.
      return (x, y, z) => {
        const left = a(x, y, z);
        return left === 0 ? 0 : left * b(x, y, z);
      };
    }
    case 'minecraft:min': {
      const a = child('argument1');
      const b = child('argument2');
      return (x, y, z) => Math.min(a(x, y, z), b(x, y, z));
    }
    case 'minecraft:max': {
      const a = child('argument1');
      const b = child('argument2');
      return (x, y, z) => Math.max(a(x, y, z), b(x, y, z));
    }
    case 'minecraft:clamp': {
      const input = child('input');
      const min = Number(n['min']);
      const max = Number(n['max']);
      return (x, y, z) => Math.max(min, Math.min(max, input(x, y, z)));
    }
    case 'minecraft:range_choice': {
      const input = child('input');
      const min = Number(n['min_inclusive']);
      const max = Number(n['max_exclusive']);
      const inRange = child('when_in_range');
      const outOfRange = child('when_out_of_range');
      return (x, y, z) => {
        const v = input(x, y, z);
        return v >= min && v < max ? inRange(x, y, z) : outOfRange(x, y, z);
      };
    }

    case 'minecraft:noise': {
      const noise = noiseOf(lookup, n['noise'], type);
      const xz = Number(n['xz_scale'] ?? 1);
      const yScale = Number(n['y_scale'] ?? 1);
      return (x, y, z) => noise.getValue(x * xz, y * yScale, z * xz);
    }
    case 'minecraft:shifted_noise': {
      const noise = noiseOf(lookup, n['noise'], type);
      const xz = Number(n['xz_scale'] ?? 1);
      const yScale = Number(n['y_scale'] ?? 1);
      const sx = child('shift_x');
      const sy = child('shift_y');
      const sz = child('shift_z');
      return (x, y, z) =>
        noise.getValue(
          x * xz + sx(x, y, z),
          y * yScale + sy(x, y, z),
          z * xz + sz(x, y, z),
        );
    }
    // `ShiftNoise`: the same sample at quarter scale, times four — the three variants differ only
    // in which coordinates they feed it, which is how one offset noise yields two independent shifts.
    case 'minecraft:shift': {
      const noise = noiseOf(lookup, n['argument'], type);
      return (x, y, z) => noise.getValue(x * 0.25, y * 0.25, z * 0.25) * 4;
    }
    case 'minecraft:shift_a': {
      const noise = noiseOf(lookup, n['argument'], type);
      return (x, _y, z) => noise.getValue(x * 0.25, 0, z * 0.25) * 4;
    }
    case 'minecraft:shift_b': {
      const noise = noiseOf(lookup, n['argument'], type);
      return (x, _y, z) => noise.getValue(z * 0.25, x * 0.25, 0) * 4;
    }

    case 'minecraft:spline':
      return compileSpline(n['spline'] as SplineNode, lookup);

    default:
      throw new Error(`density function type not ported: ${type}`);
  }
}
