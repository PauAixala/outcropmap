/** Direct ports of TFC 1.20 `net.dries007.tfc.world.biome.BiomeNoise` height factories. */
import { JavaRandom } from '@core/random';
import {
  abs,
  add,
  affine,
  clamped,
  clampedMap,
  map,
  mapRange,
  ridged,
  scaled,
  terraces,
  warped,
  lazyProduct,
  type Noise2D,
} from '../noise/noise2d';
import { OpenSimplex2D } from '../noise/open-simplex-2d';
import { VolcanoNoise } from './volcano-noise';

const SEA_LEVEL_Y = 63;
const f = Math.fround;

function longAdd(seed: bigint, offset: bigint): bigint {
  return BigInt.asIntN(64, seed + offset);
}

function simplex(seed: bigint): OpenSimplex2D {
  return new OpenSimplex2D(seed);
}

export function badlands(seed: bigint): Noise2D {
  const relief = terraces(
    scaled(
      map(
        ridged(simplex(longAdd(seed, 1n)).octaves(4).spread(f(0.04)).asNoise()),
        (x) => f(1.3) * -(x > 0 ? x * x * x : f(0.5) * x),
      ),
      f(-1),
      f(1),
      f(-1),
      f(0.3),
    ),
    15,
  );
  const height = add(
    simplex(seed)
      .octaves(4)
      .spread(f(0.025))
      .scaled(SEA_LEVEL_Y + 22, SEA_LEVEL_Y + 32)
      .asNoise(),
    scaled(relief, f(-19.5), 0),
  );
  return map(height, (x) => (x < SEA_LEVEL_Y ? SEA_LEVEL_Y - f(0.3) * (SEA_LEVEL_Y - x) : x));
}

export function bryceCanyon(seed: bigint): Noise2D {
  const random = new JavaRandom(seed);
  let noise: Noise2D = simplex(random.nextLong())
    .octaves(4)
    .spread(f(0.1))
    .scaled(SEA_LEVEL_Y + 2, SEA_LEVEL_Y + 14)
    .asNoise();
  for (let layer = 0; layer < 3; layer++) {
    const threshold = f(0.25);
    const delta = f(0.015);
    const spread = f(f(0.02) + f(f(0.01) * layer));
    const shift = f(-f(f(0.05) * layer));
    const mask = map(
      affine(abs(simplex(random.nextLong()).octaves(3).spread(spread).asNoise()), 1, shift),
      (value) => clampedMap(value, threshold, f(threshold + delta), 0, 1),
    );
    const height = simplex(random.nextLong()).octaves(4).spread(f(0.1)).scaled(5, 11).asNoise();
    noise = add(noise, lazyProduct(mask, height));
  }
  return noise;
}

export function canyons(seed: bigint, minHeight: number, maxHeight: number): Noise2D {
  const warp = simplex(seed).octaves(4).spread(f(0.03)).scaled(f(-100), f(100));
  const carved = map(
    warped(simplex(longAdd(seed, 1n)).octaves(4).spread(f(0.06)).asNoise(), warp),
    (x) => (x > 0.4 ? x - f(0.8) : -x),
  );
  return scaled(carved, SEA_LEVEL_Y + minHeight, SEA_LEVEL_Y + maxHeight, f(-0.4), f(0.8));
}

export function hills(seed: bigint, minHeight: number, maxHeight: number): Noise2D {
  return simplex(seed)
    .octaves(4)
    .spread(f(0.05))
    .scaled(SEA_LEVEL_Y + minHeight, SEA_LEVEL_Y + maxHeight)
    .asNoise();
}

export function sharpHillsMap(input: number): number {
  if (input > f(0.67)) return mapRange(input, f(0.67), f(1), f(0.7), f(1));
  if (input > f(0.15)) return mapRange(input, f(0.15), f(0.67), f(0.5), f(0.7));
  if (input > f(-0.15)) return mapRange(input, f(-0.15), f(0.15), f(-0.5), f(0.5));
  if (input > f(-0.67)) return mapRange(input, f(-0.67), f(-0.15), f(-0.7), f(-0.5));
  return mapRange(input, f(-1), f(-0.67), f(-1), f(-0.7));
}

export function sharpHills(seed: bigint): Noise2D {
  const base = simplex(seed).octaves(4).spread(f(0.08)).asNoise();
  const blend = clamped(
    simplex(longAdd(seed, 7_198_234_123n)).spread(f(0.013)).scaled(f(-0.3), f(1.6)).asNoise(),
    0,
    1,
  );
  const blended: Noise2D = (x, z) => {
    const input = base(x, z);
    const amount = blend(x, z);
    return input + amount * (sharpHillsMap(input) - input);
  };
  const variance = simplex(longAdd(seed, 67_981_832_123n))
    .octaves(3)
    .spread(f(0.06))
    .scaled(f(-0.2), f(0.2))
    .asNoise();
  return scaled(add(blended, variance), SEA_LEVEL_Y - 3, SEA_LEVEL_Y + 28, f(-0.75), f(0.7));
}

export function lake(seed: bigint): Noise2D {
  const base = simplex(seed)
    .octaves(4)
    .spread(f(0.15))
    .scaled(SEA_LEVEL_Y - 12, SEA_LEVEL_Y + 2)
    .asNoise();
  const pockets = clamped(
    scaled(
      map(simplex(longAdd(seed, 1n)).octaves(5).spread(f(0.1)).asNoise(), (value) => value ** 4),
      -2,
      2,
    ),
    0,
    2,
  );
  return add(base, pockets);
}

export function lowlands(seed: bigint): Noise2D {
  const pockets = clamped(
    simplex(longAdd(seed, 1n)).octaves(6).spread(f(0.55)).scaled(-2, 2).asNoise(),
    -2,
    1,
  );
  return add(hills(seed, -3, -2), pockets);
}

export function mountains(seed: bigint, baseHeight: number, scaleHeight: number): Noise2D {
  const ridges = ridged(
    simplex(longAdd(seed, 1n)).octaves(4).spread(f(0.02)).scaled(f(-0.7), f(0.7)).asNoise(),
  );
  const base = map(add(simplex(seed).octaves(6).spread(f(0.14)).asNoise(), ridges), (x) => {
    const shaped = f(0.125) * (x + 1) * (x + 1) * (x + 1);
    return SEA_LEVEL_Y + baseHeight + scaleHeight * shaped;
  });
  const cliff = map(
    simplex(longAdd(seed, 2n)).octaves(2).spread(f(0.01)).scaled(-25, 25).asNoise(),
    (x) => (x > 0 ? x : 0),
  );
  const cliffHeight = simplex(longAdd(seed, 3n))
    .octaves(2)
    .spread(f(0.01))
    .scaled(120, 160)
    .asNoise();
  return (x, z) => {
    let height = base(x, z);
    if (height > 120) {
      const delta = cliffHeight(x, z) - height;
      if (delta < 0) height += clampedMap(delta, 0, -1, 0, 1) * cliff(x, z);
    }
    return height;
  };
}

export function ocean(seed: bigint, depthMin: number, depthMax: number): Noise2D {
  const warp = simplex(seed).octaves(2).spread(f(0.015)).scaled(-30, 30);
  const base = simplex(longAdd(seed, 1n))
    .octaves(4)
    .spread(f(0.11))
    .scaled(SEA_LEVEL_Y + depthMin, SEA_LEVEL_Y + depthMax)
    .asNoise();
  return warped(base, warp);
}

export function oceanRidge(seed: bigint, depthMin: number, depthMax: number): Noise2D {
  const warp = simplex(seed).octaves(2).spread(f(0.015)).scaled(-30, 30);
  const ridge = map(
    ridged(simplex(longAdd(seed, 1n)).octaves(4).spread(f(0.015)).asNoise()),
    (value) => {
      if (value <= f(-0.3)) return 0;
      const scaledValue = (value + f(0.3)) / f(1.3);
      return f(-16) * scaledValue * scaledValue * scaledValue;
    },
  );
  const base = simplex(longAdd(seed, 2n))
    .octaves(4)
    .spread(f(0.11))
    .scaled(SEA_LEVEL_Y + depthMin, SEA_LEVEL_Y + depthMax)
    .asNoise();
  return warped(add(base, ridge), warp);
}

export function shore(seed: bigint): Noise2D {
  return simplex(seed)
    .octaves(4)
    .spread(f(0.17))
    .scaled(SEA_LEVEL_Y, SEA_LEVEL_Y + f(5))
    .asNoise();
}

export function tidalFlats(seed: bigint): Noise2D {
  return simplex(seed)
    .octaves(4)
    .spread(f(0.17))
    .scaled(SEA_LEVEL_Y, f(SEA_LEVEL_Y + f(1.8)))
    .asNoise();
}

export function addVolcanoes(
  seed: bigint,
  baseNoise: Noise2D,
  rarity: number,
  baseVolcanoHeight: number,
  scaleVolcanoHeight: number,
): Noise2D {
  const volcanoes = new VolcanoNoise(seed);
  return (x, z) =>
    volcanoes.modifyHeight(x, z, baseNoise(x, z), rarity, baseVolcanoHeight, scaleVolcanoHeight);
}
