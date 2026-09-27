/**
 * A fluent `Noise2D` wrapper that mirrors TFC's Java interface **method for method**.
 *
 * TerraFirmaGreg's `TFGBiomeNoise` is ~1000 lines of chained noise, and the chains are the whole
 * definition of its terrain — 77 `.spread(...)`, 76 `.map(...)`, 60 `.scaled(...)` and so on. The
 * safe way to port that volume is to make the TypeScript read the same as the Java, so each function
 * is a transcription that can be diffed against its source by eye, rather than a translation where
 * every line is a chance to reorder an argument.
 *
 * **The specific trap this exists to close.** `Noise2D.scaled` is overloaded in Java:
 *
 * ```java
 * scaled(double min, double max)                              // maps [-1, 1] -> [min, max]
 * scaled(double oldMin, double oldMax, double min, double max) // maps [oldMin, oldMax] -> [min, max]
 * ```
 *
 * The four-argument form puts the *source* range first. This project's own `scaled(noise, min, max,
 * oldMin, oldMax)` helper puts it last, so a call transcribed positionally comes out silently
 * inverted — terrain that still looks like terrain, at the wrong altitudes. Here `scaled` takes both
 * shapes with Java's own ordering, so `.scaled(-0.4f, 0.8f, -8, 8)` transcribes unchanged.
 */
import { OpenSimplex2D } from '@worldgen/tfc-1.20/noise/open-simplex-2d';
import {
  abs as absOf,
  add as addOf,
  clamped as clampedOf,
  lazyProduct as lazyProductOf,
  map as mapOf,
  max as maxOf,
  min as minOf,
  octavesOf,
  ridged as ridgedOf,
  scaled as scaledOf,
  spreadInput as spreadInputOf,
  terraces as terracesOf,
  warped as warpedOf,
  type Noise2D,
} from '@worldgen/tfc-1.20/noise/noise2d';

/** `net.dries007.tfc.world.noise.Noise2D`'s default methods, in Java's own argument order. */
export class NoiseChain {
  constructor(private readonly noise: Noise2D) {}

  /** The bare function, for callers that just want to sample. */
  get fn(): Noise2D {
    return this.noise;
  }

  noiseAt(x: number, z: number): number {
    return this.noise(x, z);
  }

  /**
   * `scaled(min, max)` and `scaled(oldMin, oldMax, min, max)`. The four-argument form takes the
   * **source** range first, as Java does — see this file's header for why that matters.
   */
  scaled(a: number, b: number, c?: number, d?: number): NoiseChain {
    return c === undefined || d === undefined
      ? new NoiseChain(scaledOf(this.noise, a, b))
      : new NoiseChain(scaledOf(this.noise, c, d, a, b));
  }

  clamped(min: number, max: number): NoiseChain {
    return new NoiseChain(clampedOf(this.noise, min, max));
  }

  map(fn: (value: number) => number): NoiseChain {
    return new NoiseChain(mapOf(this.noise, fn));
  }

  add(other: NoiseChain | Noise2D): NoiseChain {
    return new NoiseChain(addOf(this.noise, unwrap(other)));
  }

  lazyProduct(other: NoiseChain | Noise2D): NoiseChain {
    return new NoiseChain(lazyProductOf(this.noise, unwrap(other)));
  }

  min(other: NoiseChain | Noise2D): NoiseChain {
    return new NoiseChain(minOf(this.noise, unwrap(other)));
  }

  max(other: NoiseChain | Noise2D): NoiseChain {
    return new NoiseChain(maxOf(this.noise, unwrap(other)));
  }

  /**
   * `Noise2D.octaves(int)` — the **interface default method**, which wraps any field in a manual FBm
   * sum. This is *not* `OpenSimplex2D.octaves(int)`, which instead switches FastNoiseLite into FBm
   * mode and multiplies the generator's own frequency by `1 / 2^(n-1)`.
   *
   * Java picks between them by static type, and TFG relies on both. `new OpenSimplex2D(seed)
   * .octaves(4)` gets the generator's version; `...spread(0.01).ridged().octaves(3)` gets this one,
   * because `ridged()` has already returned the interface. Transcribing one as the other yields
   * terrain at a plausible-looking wrong scale, so `simplex(seed, { octaves })` is the only way to
   * reach the generator's version and this method is the only way to reach the wrapper.
   */
  octaves(count: number): NoiseChain {
    return new NoiseChain(octavesOf(this.noise, count));
  }

  /**
   * `Noise2D.spread(double)` — the interface default, which scales the **input coordinates** of an
   * existing field. Same two-methods trap as `octaves`: `OpenSimplex2D.spread` instead multiplies
   * the generator's own frequency before it produces anything.
   *
   * The difference is not cosmetic. `TFGBiomeNoise.lavaFlow` is `.ridged().spread(0.01)` — ridging
   * first and stretching the result — which is a different field from stretching first and ridging
   * that.
   */
  spread(scaleFactor: number): NoiseChain {
    return new NoiseChain(spreadInputOf(this.noise, scaleFactor));
  }

  abs(): NoiseChain {
    return new NoiseChain(absOf(this.noise));
  }

  ridged(): NoiseChain {
    return new NoiseChain(ridgedOf(this.noise));
  }

  terraces(levels: number): NoiseChain {
    return new NoiseChain(terracesOf(this.noise, levels));
  }

  /**
   * `warped` displaces the *input* coordinates, so it needs a warp source that can move a cursor —
   * a concrete `OpenSimplex2D`, not any old field. TFG always passes one.
   */
  warped(warp: OpenSimplex2D): NoiseChain {
    return new NoiseChain(warpedOf(this.noise, warp));
  }
}

function unwrap(value: NoiseChain | Noise2D): Noise2D {
  return typeof value === 'function' ? value : value.fn;
}

/** Wraps a plain function so a lambda can start a chain, as `(x, z) -> ...` does in Java. */
export function chain(noise: Noise2D): NoiseChain {
  return new NoiseChain(noise);
}

/**
 * `new OpenSimplex2D(seed).octaves(n).spread(s)` as a chain.
 *
 * `octaves` and `spread` stay on the concrete simplex rather than the chain because both mutate the
 * generator's own frequency, and the order they are applied in compounds (see
 * `OpenSimplex2D.octaves`). Keeping them here means a transcription cannot accidentally reorder
 * them past a combinator that would change the result.
 */
export function simplex(
  seed: bigint,
  options: { readonly octaves?: number; readonly spread?: number } = {},
): NoiseChain {
  // Built once, here, rather than inside the closure.
  //
  // Measured honestly: constructing an OpenSimplex2D per sample costs about 7% over 20 000 samples,
  // not the multiple an earlier note here claimed — the noise evaluation dominates its own setup.
  // The reason to keep it out of the closure is the garbage, not the arithmetic: this runs per
  // pixel of every terrain tile, and per-sample allocation there is what CLAUDE.md section 6 rules
  // out. A timing test could not assert this at 7%, so there is deliberately no test for it.
  const noise = rawSimplex(seed, options);
  return new NoiseChain((x, z) => noise.noise(x, z));
}

/**
 * The concrete generator, for the places TFG needs one rather than a chain — a `warped` source, or
 * a `.scaled()` applied before the noise is wrapped.
 */
export function rawSimplex(
  seed: bigint,
  options: { readonly octaves?: number; readonly spread?: number; readonly scaled?: readonly [number, number] } = {},
): OpenSimplex2D {
  const noise = new OpenSimplex2D(seed);
  if (options.octaves !== undefined) noise.octaves(options.octaves);
  if (options.spread !== undefined) noise.spread(options.spread);
  if (options.scaled !== undefined) noise.scaled(options.scaled[0], options.scaled[1]);
  return noise;
}
