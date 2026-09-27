/**
 * Direct port of TFC 1.20 `net.dries007.tfc.world.biome.VolcanoNoise`.
 *
 * The class mixes Java `float` and `double` arithmetic. Every helper below marks a real float
 * operation in the source; retaining those roundings is required for parity at the volcano rim.
 */
import { Cellular2D, type Cell } from '../noise/cellular-2d';
import { OpenSimplex2D } from '../noise/open-simplex-2d';

const SEA_LEVEL_Y = 63;
const CELL_SPREAD = Math.fround(0.009);
const JITTER_MIN = Math.fround(-0.0016);
const JITTER_MAX = Math.fround(0.0016);
const JITTER_SPREAD = Math.fround(0.128);
const EASING_LIMIT = Math.fround(0.23);
const SHAPE_SCALE = Math.fround(0.279173646008);

function fadd(a: number, b: number): number {
  return Math.fround(Math.fround(a) + Math.fround(b));
}

function fmul(a: number, b: number): number {
  return Math.fround(Math.fround(a) * Math.fround(b));
}

function fdiv(a: number, b: number): number {
  return Math.fround(Math.fround(a) / Math.fround(b));
}

function calculateEasingValue(f1: number): number {
  const delta = fdiv(Math.fround(f1), EASING_LIMIT);
  return fadd(1, fmul(delta, -1));
}

function calculateClampedEasing(f1: number): number {
  return Math.max(0, Math.min(1, calculateEasingValue(f1)));
}

function calculateShape(t: number): number {
  const ft = Math.fround(t);
  if (ft > Math.fround(0.025)) {
    const denominator = fadd(fmul(9, ft), 1);
    return fmul(fadd(fdiv(5, denominator), -0.5), SHAPE_SCALE);
  }
  const a = fadd(fmul(ft, 9), 0.05);
  return fmul(fadd(fmul(8, fmul(a, a)), Math.fround(2.97663265306)), SHAPE_SCALE);
}

export interface VolcanoCenter {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class VolcanoNoise {
  private readonly cellNoise: Cellular2D;
  private readonly jitterNoise: OpenSimplex2D;

  constructor(seed: bigint) {
    this.cellNoise = new Cellular2D(seed).spread(CELL_SPREAD);
    this.jitterNoise = new OpenSimplex2D(BigInt.asIntN(64, seed + 1_234_123n))
      .octaves(2)
      .scaled(JITTER_MIN, JITTER_MAX)
      .spread(JITTER_SPREAD);
  }

  private sampleCell(x: number, z: number, rarity: number): Cell | null {
    const cell = this.cellNoise.cell(x, z);
    const threshold = Math.fround(1 / rarity);
    return Math.abs(cell.noise) <= threshold ? cell : null;
  }

  modifyHeight(
    x: number,
    z: number,
    baseHeight: number,
    rarity: number,
    baseVolcanoHeight: number,
    scaleVolcanoHeight: number,
  ): number {
    const cell = this.sampleCell(x, z, rarity);
    if (cell === null) return baseHeight;

    const easing = Math.max(
      0,
      Math.min(
        1,
        fadd(calculateEasingValue(Math.fround(cell.f1)), Math.fround(this.jitterNoise.noise(x, z))),
      ),
    );
    const shape = calculateShape(fadd(1, -easing));
    const additionalHeight = fmul(shape, scaleVolcanoHeight);
    const volcanoHeight = fadd(fadd(SEA_LEVEL_Y, baseVolcanoHeight), additionalHeight);
    const raisedBase = baseHeight + fmul(0.4, additionalHeight);
    const target = 0.5 * (volcanoHeight + Math.max(volcanoHeight, raisedBase));
    return baseHeight + easing * (target - baseHeight);
  }

  calculateEasing(x: number, z: number, rarity: number): number {
    const cell = this.sampleCell(x, z, rarity);
    return cell === null ? 0 : calculateClampedEasing(Math.fround(cell.f1));
  }

  calculateCenter(x: number, y: number, z: number, rarity: number): VolcanoCenter | null {
    const cell = this.sampleCell(x, z, rarity);
    return cell === null ? null : { x: Math.trunc(cell.x), y, z: Math.trunc(cell.y) };
  }
}
