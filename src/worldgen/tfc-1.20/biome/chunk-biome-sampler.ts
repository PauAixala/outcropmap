import { Biome } from './ids';

export type BiomeWeights = Map<Biome, number>;

const KERNEL_RADIUS = 4;
/** Distinct sample offsets per axis: (-80..96) / 4 + 1. See `sampleChunkBiomes`. */
const SAMPLE_SPAN = 45;
const KERNEL_WIDTH = KERNEL_RADIUS * 2 + 1;
const KERNEL_9X9 = Array.from({ length: KERNEL_WIDTH * KERNEL_WIDTH }, (_, index) => {
  const x = (index % KERNEL_WIDTH) - KERNEL_RADIUS;
  const z = Math.floor(index / KERNEL_WIDTH) - KERNEL_RADIUS;
  return 0.0211640211641 * (1 - 0.03125 * (z * z + x * x));
});

function blendGroup(biome: Biome): number {
  if ((biome >= Biome.OCEAN && biome <= Biome.DEEP_OCEAN_TRENCH) || biome === Biome.TIDAL_FLATS) {
    return 1;
  }
  if (biome >= Biome.LAKE && biome !== Biome.RIVER) return 2;
  return 0;
}

function merge(target: BiomeWeights, biome: Biome, weight: number): void {
  target.set(biome, (target.get(biome) ?? 0) + weight);
}

function sampleWithKernel(
  target: BiomeWeights,
  biomeAtBlock: (x: number, z: number) => Biome,
  kernelBits: number,
  chunkX: number,
  chunkZ: number,
  xOffset: number,
  zOffset: number,
): void {
  for (let dx = -KERNEL_RADIUS; dx <= KERNEL_RADIUS; dx++) {
    for (let dz = -KERNEL_RADIUS; dz <= KERNEL_RADIUS; dz++) {
      const weight = KERNEL_9X9[dx + KERNEL_RADIUS + (dz + KERNEL_RADIUS) * KERNEL_WIDTH] ?? 0;
      const blockX = chunkX + (xOffset + dx) * (1 << kernelBits);
      const blockZ = chunkZ + (zOffset + dz) * (1 << kernelBits);
      merge(target, biomeAtBlock(blockX, blockZ), weight);
    }
  }
}

function addCorner(target: BiomeWeights, corner: BiomeWeights, amount: number): void {
  if (amount <= 0) return;
  for (const [biome, weight] of corner) merge(target, biome, weight * amount);
}

function composeWeights(weights: BiomeWeights, broadWeights: BiomeWeights): void {
  const broadTotals = [0, 0, 0];
  const localTotals = [0, 0, 0];
  for (const [biome, weight] of broadWeights) broadTotals[blendGroup(biome)]! += weight;
  for (const [biome, weight] of weights) localTotals[blendGroup(biome)]! += weight;
  weights.clear();
  for (const [biome, weight] of broadWeights) {
    const group = blendGroup(biome);
    const local = localTotals[group] ?? 0;
    const broad = broadTotals[group] ?? 0;
    if (local > 0 && broad > 0) weights.set(biome, (weight * local) / broad);
  }
}

/** Exact port of TFC `ChunkBiomeSampler.sampleBiomes`. */
export function sampleChunkBiomes(
  chunkPosX: number,
  chunkPosZ: number,
  biomeAtBlock: (x: number, z: number) => Biome,
): BiomeWeights[] {
  const chunkX = chunkPosX * 16;
  const chunkZ = chunkPosZ * 16;
  // The Java biome source is cached internally. Preserve the same answers while avoiding thousands
  // of repeated quart-layer lookups in the browser implementation.
  //
  // Every sampled position is a multiple of 4 blocks within [-80, 96] of the chunk origin (the
  // broad kernel reaches (-1-4)*16 and (2+4)*16), so a flat 45x45 table indexes them exactly.
  // It replaced a `${x},${z}`-keyed Map whose key strings were a visible slice of a relief tile.
  const sampled = new Int32Array(SAMPLE_SPAN * SAMPLE_SPAN).fill(-1);
  const cachedBiomeAtBlock = (x: number, z: number): Biome => {
    const slot = ((x - chunkX + 80) >> 2) * SAMPLE_SPAN + ((z - chunkZ + 80) >> 2);
    let biome = sampled[slot]!;
    if (biome === -1) {
      biome = biomeAtBlock(x, z);
      sampled[slot] = biome;
    }
    return biome as Biome;
  };
  const broad: BiomeWeights[] = Array.from({ length: 16 }, () => new Map());
  for (let x = 0; x < 4; x++) {
    for (let z = 0; z < 4; z++) {
      sampleWithKernel(
        broad[x | (z << 2)]!,
        cachedBiomeAtBlock,
        4,
        chunkX,
        chunkZ,
        x - 1,
        z - 1,
      );
    }
  }

  const quart: BiomeWeights[] = Array.from({ length: 49 }, () => new Map());
  for (let x = 0; x < 7; x++) {
    for (let z = 0; z < 7; z++) {
      const weights = quart[x + 7 * z]!;
      const interpolatedBroad: BiomeWeights = new Map();
      sampleWithKernel(weights, cachedBiomeAtBlock, 2, chunkX, chunkZ, x - 1, z - 1);
      const x1 = chunkX + (x - 1) * 4;
      const z1 = chunkZ + (z - 1) * 4;
      const coordX = Math.floor(x1 / 16);
      const coordZ = Math.floor(z1 / 16);
      const lerpX = (x1 - coordX * 16) / 16;
      const lerpZ = (z1 - coordZ * 16) / 16;
      const indexX = Math.floor((x1 - chunkX) / 16) + 1;
      const indexZ = Math.floor((z1 - chunkZ) / 16) + 1;
      addCorner(interpolatedBroad, broad[indexX | (indexZ << 2)]!, (1 - lerpX) * (1 - lerpZ));
      addCorner(interpolatedBroad, broad[(indexX + 1) | (indexZ << 2)]!, lerpX * (1 - lerpZ));
      addCorner(interpolatedBroad, broad[indexX | ((indexZ + 1) << 2)]!, (1 - lerpX) * lerpZ);
      addCorner(interpolatedBroad, broad[(indexX + 1) | ((indexZ + 1) << 2)]!, lerpX * lerpZ);
      composeWeights(weights, interpolatedBroad);
    }
  }
  return quart;
}

/** Exact port of TFC `ChunkBiomeSampler.sampleBiomesColumn`. */
export function sampleBiomeColumn(
  corners: BiomeWeights[],
  localX: number,
  localZ: number,
): BiomeWeights {
  const indexX = Math.floor(localX / 4) + 1;
  const indexZ = Math.floor(localZ / 4) + 1;
  const lerpX = (localX - Math.floor(localX / 4) * 4) / 4;
  const lerpZ = (localZ - Math.floor(localZ / 4) * 4) / 4;
  const weights: BiomeWeights = new Map();
  addCorner(weights, corners[indexX + indexZ * 7]!, (1 - lerpX) * (1 - lerpZ));
  addCorner(weights, corners[indexX + 1 + indexZ * 7]!, lerpX * (1 - lerpZ));
  addCorner(weights, corners[indexX + (indexZ + 1) * 7]!, (1 - lerpX) * lerpZ);
  addCorner(weights, corners[indexX + 1 + (indexZ + 1) * 7]!, lerpX * lerpZ);
  return weights;
}
