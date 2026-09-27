/**
 * `net.minecraft.world.level.biome.Climate` — how a `multi_noise` biome source turns six noise
 * values into a biome.
 *
 * Every biome claims a box in six-dimensional climate space plus a seventh scalar, `offset`, which
 * acts as a flat penalty. A position's six values are quantized to ten-thousandths and the biome
 * whose box is *nearest* wins: distance is zero inside the box and the overshoot outside it, and
 * the fitness is the sum of the squares plus `offset²`. Nothing here is a threshold, so a position
 * always gets a biome, even one no box contains.
 *
 * Vanilla indexes the boxes in an R-tree because the overworld has hundreds. The dimensions here
 * have between 1 and 54, and a linear scan over 54 boxes is not worth a tree.
 */

/** `Climate.quantizeCoord`: the fixed-point form every comparison happens in. */
export function quantizeCoord(value: number): number {
  return Math.trunc(value * 10000);
}

/** One biome's claim: `[min, max]` per parameter in the datapack's own float units. */
export interface ClimateEntry {
  readonly biome: string;
  readonly parameters: Readonly<Record<string, number | readonly number[]>>;
}

const AXES = ['temperature', 'humidity', 'continentalness', 'erosion', 'depth', 'weirdness'] as const;

/** A number, `[min, max]`, or `{min, max}` — the datapack accepts all three. */
function range(value: number | readonly number[] | undefined): [number, number] {
  if (value === undefined) return [0, 0];
  if (typeof value === 'number') return [quantizeCoord(value), quantizeCoord(value)];
  return [quantizeCoord(value[0] ?? 0), quantizeCoord(value[1] ?? 0)];
}

/** The six values a router produces at one position, in the order `AXES` lists. */
export type ClimateTarget = readonly [number, number, number, number, number, number];

/**
 * The boxes, flattened into one typed array so the scan is a tight loop over numbers rather than a
 * walk over 54 objects with seven fields each.
 */
export class ClimateSearch {
  private readonly bounds: Int32Array;
  private readonly offsets: Float64Array;
  readonly biomes: readonly string[];

  constructor(entries: readonly ClimateEntry[]) {
    this.biomes = entries.map((e) => e.biome);
    this.bounds = new Int32Array(entries.length * 12);
    this.offsets = new Float64Array(entries.length);
    entries.forEach((entry, i) => {
      AXES.forEach((axis, a) => {
        const [min, max] = range(entry.parameters[axis]);
        this.bounds[i * 12 + a * 2] = min;
        this.bounds[i * 12 + a * 2 + 1] = max;
      });
      const offset = quantizeCoord(Number(entry.parameters['offset'] ?? 0));
      this.offsets[i] = offset * offset;
    });
  }

  /** `Climate.RTree#search` reduced to a scan: the entry of least fitness, `null` if there are none. */
  find(target: ClimateTarget): string | null {
    let best = -1;
    let bestFitness = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.biomes.length; i++) {
      const base = i * 12;
      let fitness = this.offsets[i]!;
      for (let a = 0; a < 6; a++) {
        const value = target[a]!;
        const min = this.bounds[base + a * 2]!;
        const max = this.bounds[base + a * 2 + 1]!;
        // `Climate.Parameter#distance`: zero inside the box, the overshoot outside it.
        const d = value > max ? value - max : value < min ? min - value : 0;
        fitness += d * d;
        if (fitness >= bestFitness) break;
      }
      if (fitness < bestFitness) {
        bestFitness = fitness;
        best = i;
      }
    }
    return best < 0 ? null : this.biomes[best]!;
  }
}
