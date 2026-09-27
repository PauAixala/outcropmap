import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import { createGenerator } from '../../src/worldgen/registry';
import { resolveDepositDepth } from '../../src/worldgen/api/depth';
import type { BlockBox, DepositFeature } from '../../src/worldgen/api/types';

const BOX: BlockBox = { minX: 0, minZ: 0, maxX: 255, maxZ: 255 };

const DEPOSIT: DepositFeature = {
  id: 'test',
  kind: 'ore',
  ore: 'tfc:normal_hematite',
  shape: 'cluster',
  x: 100,
  z: 200,
  topY: 40,
  bottomY: 20,
  surfaceY: null,
  depthBelowSurface: null,
  exposure: 'unknown',
  hostRock: 'granite',
  hasIndicator: true,
  indicator: { rarity: 10, depth: 35 },
  indicatorReach: 'unknown',
  rarity: 60,
  size: 8,
};

describe('resolveDepositDepth', () => {
  it('reports the surface at the deposit centre, and the depth to the top of the vein', () => {
    const [result] = resolveDepositDepth([DEPOSIT], BOX, () => 80);
    expect(result?.surfaceY).toBe(80);
    expect(result?.depthBelowSurface).toBe(40);
  });

  it('goes negative when the vein reaches above the surface but is still cut by it', () => {
    // topY 40 is above ground, bottomY 20 is below: the game places the lower part and stops.
    const [result] = resolveDepositDepth([DEPOSIT], BOX, () => 30);
    expect(result?.depthBelowSurface).toBe(-10);
  });

  it('drops a deposit whose whole Y range sits above the ground', () => {
    // Nothing to walk to: `VeinFeature.place` only replaces raw rock, and there is none up there.
    expect(resolveDepositDepth([DEPOSIT], BOX, () => 10)).toEqual([]);
  });

  it('keeps a deposit that only one column of its footprint reaches', () => {
    // The peak is 20 blocks east of centre, inside the footprint, and the centre is far too low.
    // Testing the centre column alone would hide real ore -- the worse of the two errors.
    const wide = { ...DEPOSIT, size: 24 };
    const kept = resolveDepositDepth([wide], BOX, (x) => (x > 118 ? 60 : 10));
    expect(kept).toHaveLength(1);
    // The reported surface is still the one at the centre, not the peak that saved it.
    expect(kept[0]?.surfaceY).toBe(10);
  });

  it('leaves everything untouched for a profile with no height field', () => {
    // `tfg` today. Never a guessed depth, and never a deposit dropped on a height we do not have.
    expect(resolveDepositDepth([DEPOSIT], BOX, () => null)).toEqual([DEPOSIT]);
  });

  it('rules out a surface indicator only when the geometry makes it impossible', () => {
    // `Indicator.depth` is 35 here: the surface must be within 35 blocks of the topmost ore, and
    // the topmost ore can never be above the vein's own top. So a deeper vein is a certain no, and
    // anything shallower is only a maybe -- the rarity roll and the ore generating at all are still
    // in the way.
    const at34 = resolveDepositDepth([DEPOSIT], BOX, () => DEPOSIT.topY + 34);
    expect(at34[0]?.indicatorReach).toBe('possible');
    const at35 = resolveDepositDepth([DEPOSIT], BOX, () => DEPOSIT.topY + 35);
    expect(at35[0]?.indicatorReach).toBe('too-deep');
  });

  it('says none for a vein with no above-ground indicator at all', () => {
    // `rarity == 0` short-circuits the branch in Java: underground indicators only. Five of TFC's
    // 20 indicator veins are in that state.
    const underground = { ...DEPOSIT, indicator: { rarity: 0, depth: 35 } };
    expect(resolveDepositDepth([underground], BOX, () => 80)[0]?.indicatorReach).toBe('none');
    const bare = { ...DEPOSIT, indicator: null };
    expect(resolveDepositDepth([bare], BOX, () => 80)[0]?.indicatorReach).toBe('none');
  });

  it('never claims an exposure class it cannot compute', () => {
    // The soil cap and the carvers are both unported, so "can I see it?" stays unanswered.
    const [result] = resolveDepositDepth([DEPOSIT], BOX, () => 80);
    expect(result?.exposure).toBe('unknown');
  });
});

describe('tfc-1.20 deposits carry a real depth', () => {
  const generator = createGenerator('tfc-1.20', { seed: 0n, dimension: 'overworld' });
  const box: BlockBox = { minX: 0, minZ: 0, maxX: 511, maxZ: 511 };
  const deposits = generator.features(box).deposits;

  it('fills depth from the generator surface height and keeps it consistent', () => {
    expect(deposits.length).toBeGreaterThan(0);
    for (const deposit of deposits) {
      expect(deposit.surfaceY).not.toBeNull();
      expect(deposit.depthBelowSurface).toBe(deposit.surfaceY! - deposit.topY);
      expect(deposit.surfaceY).toBe(generator.surfaceY(deposit.x, deposit.z));
    }
  });

  it('drops a meaningful share of the deposits, and only phantoms', () => {
    // Three filters stand between a rolled vein and a marker. On this box, seed 0: 1 145 candidates
    // once veins whose band is thin air are dropped -> 241 after the host-rock gate and depth
    // resolution. Each tightening has been paid for in measured precision against a real world
    // (84.3% -> 90.4%, docs/PARITY.md); drawing every candidate would send the player to ore that
    // is not there most of the time.
    expect(deposits.length).toBeGreaterThan(180);
    expect(deposits.length).toBeLessThan(320);
  });

  it('every surviving deposit has ground in reach that its bottom can meet', () => {
    // The drop rule, checked against the generator rather than a stub. `maxAround` widens the
    // footprint by one grid cell on each side to bias toward keeping a marker, so the scan here
    // uses the same reach -- and scans it more densely than the grid does, which can only find a
    // higher peak. A survivor must clear that.
    const REACH = 4;
    for (const deposit of deposits.filter((_, index) => index % 8 === 0)) {
      const radius =
        (deposit.blocksAcross !== undefined
          ? Math.ceil(deposit.blocksAcross / 2)
          : (deposit.size ?? 8)) + REACH;
      let highest = -Infinity;
      for (let dz = -radius; dz <= radius; dz += 2)
        for (let dx = -radius; dx <= radius; dx += 2)
          highest = Math.max(highest, generator.surfaceY(deposit.x + dx, deposit.z + dz)!);
      expect(deposit.bottomY).toBeLessThanOrEqual(highest);
    }
  });
});

describe('resolveDepositDepth samples only what it reads', () => {
  // The sparse grid must give exactly what sampling the whole region gave. A brute-force reference:
  // the same windows, read straight from the height function.
  it('matches a full-lattice reference on scattered deposits, and samples far less', () => {
    const height = (x: number, z: number): number => 70 + Math.round(20 * Math.sin(x / 37) + 15 * Math.cos(z / 23));
    let calls = 0;
    const counted = (x: number, z: number): number => {
      calls++;
      return height(x, z);
    };
    const box = { minX: 0, minZ: 0, maxX: 511, maxZ: 511 };
    const deposits = Array.from({ length: 12 }, (_, i) => ({
      id: `d${i}`,
      ore: 'tfc:test',
      x: (i * 97) % 512,
      z: (i * 53) % 512,
      bottomY: 60 + (i % 5) * 6,
      topY: 70 + (i % 5) * 6,
      rarity: 1,
      size: 4 + (i % 3) * 5,
      indicator: null,
    })) as unknown as Parameters<typeof resolveDepositDepth>[0];

    const resolved = resolveDepositDepth(deposits, box, counted);

    const STEP = 4;
    const MARGIN = 64;
    const reference = deposits.flatMap((deposit) => {
      const radius = (deposit as { size: number }).size;
      const reach = radius + STEP;
      let best: number | null = null;
      for (let z = box.minZ - MARGIN; z <= box.maxZ + MARGIN; z += STEP) {
        for (let x = box.minX - MARGIN; x <= box.maxX + MARGIN; x += STEP) {
          if (x >= deposit.x - reach && x <= deposit.x + reach && z >= deposit.z - reach && z <= deposit.z + reach) {
            const h = height(x, z);
            if (best === null || h > best) best = h;
          }
        }
      }
      if (best !== null && deposit.bottomY > best) return [];
      return [{ id: deposit.id, surfaceY: height(deposit.x, deposit.z) }];
    });

    expect(resolved.map((d) => ({ id: d.id, surfaceY: d.surfaceY }))).toEqual(reference);
    // The whole region with its margin would be 161 x 161 = 25 921 samples.
    expect(calls).toBeLessThan(25_921 / 4);
  });
});
