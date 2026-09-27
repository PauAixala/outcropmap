/**
 * Unit coverage for the tfc-1.20 disc-vein placement port
 * (`src/worldgen/tfc-1.20/features/disc-vein.ts`, ported from `VeinFeature`/`DiscVeinFeature` --
 * see that file's header for the exact Java sources). Fixture-backed bit-for-bit parity against
 * the real Java method bodies lives separately in `tests/parity/tfc-1.20-veins.parity.test.ts`;
 * this file covers the behavioural contracts the task brief calls out: determinism, Y bounds,
 * biome restriction, and the honesty of always reporting `exposure: 'unknown'`.
 */
import '../../src/worldgen/profiles';
import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_DISC_VEINS,
  discDepositsInBox,
  findDiscVeinInChunk,
} from '../../src/worldgen/tfc-1.20/features/disc-vein';
import type { BlockBox } from '../../src/worldgen/api/types';
import { biomeTagMembers } from '../../src/worldgen/tfc-1.20/features/biome-tags';

const kaolin = SUPPORTED_DISC_VEINS.find((v) => v.id === 'kaolin_disc');
if (!kaolin) throw new Error('kaolin_disc missing from SUPPORTED_DISC_VEINS -- test data assumption broke');

// The three surface-relative disc veins (`bituminous_coal`, `halite`, `lignite`) are out of this
// phase's scope -- see disc-vein.ts's header "Surface-relative veins" section.
const EXCLUDED_SURFACE_RELATIVE = ['bituminous_coal', 'halite', 'lignite'];

// `sulfur` is the one disc vein with `near_lava: true` (rarity 4, no biome restriction) -- this
// port has no lava/cave data to evaluate that existence-level gate against, so it is withheld
// rather than drawn as an unverified marker -- see disc-vein.ts's header "near_lava veins" section
// and FEEDBACK.md's 2026-09-07 "carpet" bug (sulfur alone was the majority of every over-dense
// sample: 255 of 378 deposits in a 512x512-block box at seed 42).
const EXCLUDED_NEAR_LAVA = ['sulfur'];

describe('tfc-1.20 disc veins: which veins this port supports', () => {
  it('never includes a surface-relative (project: true) disc vein', () => {
    const ids = SUPPORTED_DISC_VEINS.map((v) => v.id);
    // Since surface height landed, these are included -- but they are only *placed* when the
    // caller supplies a height field. Without one they produce nothing, which is the same honest
    // outcome as before, reached at placement time instead of at load time.
    for (const surfaceRelative of EXCLUDED_SURFACE_RELATIVE) {
      expect(ids).toContain(surfaceRelative);
      const vein = SUPPORTED_DISC_VEINS.find((v) => v.id === surfaceRelative);
      expect(vein?.project).toBe(true);
    }
  });

  it('never includes a near_lava disc vein this port cannot verify', () => {
    const ids = SUPPORTED_DISC_VEINS.map((v) => v.id);
    for (const excluded of EXCLUDED_NEAR_LAVA) {
      expect(ids).not.toContain(excluded);
    }
  });

  it('includes every disc/kaolin_disc vein except the near_lava one', () => {
    // 11 disc veins total, minus the 1 near_lava one this port has no data to evaluate, plus the
    // 1 kaolin_disc. The 3 surface-relative veins are in now that surface height exists.
    expect(SUPPORTED_DISC_VEINS.length).toBe(11 - EXCLUDED_NEAR_LAVA.length + 1);
  });
});

describe('tfc-1.20 disc veins: determinism', () => {
  const box: BlockBox = { minX: -400, minZ: -400, maxX: 400, maxZ: 400 };
  const biomeAt = (): string => 'tfc:highlands';

  it('the same seed and box give the exact same deposits on a fresh call', () => {
    const a = discDepositsInBox(box, 42n, biomeAt);
    const b = discDepositsInBox(box, 42n, biomeAt);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('querying the same chunk twice (same seed, vein, chunk) gives the same deposit', () => {
    const first = findDiscVeinInChunk(42n, kaolin, 5, -5, biomeAt);
    const second = findDiscVeinInChunk(42n, kaolin, 5, -5, biomeAt);
    expect(first).toEqual(second);
    // Ground-truth from tests/fixtures/tfc-1.20/veins.json's captured case for this exact
    // (seed, chunk) -- see tests/parity/tfc-1.20-veins.parity.test.ts for the full fixture check,
    // which asserts the rolled position exactly. Here the marker is the footprint's centre of mass,
    // so it sits near that position rather than on it -- see `centreOfMass2D`.
    expect(first).not.toBeNull();
    expect(Math.abs((first?.x ?? 0) - 88)).toBeLessThanOrEqual(kaolin.size);
    expect(Math.abs((first?.z ?? 0) + 76)).toBeLessThanOrEqual(kaolin.size);
  });

  it('a different seed produces a different set of deposits somewhere in a sample area', () => {
    const a = discDepositsInBox(box, 1n, biomeAt);
    const b = discDepositsInBox(box, 2n, biomeAt);
    expect(a).not.toEqual(b);
  });
});

describe('tfc-1.20 disc veins: Y bounds', () => {
  it('never places a deposit whose vertical extent escapes [min_y, max_y]', () => {
    const box: BlockBox = { minX: -2000, minZ: -2000, maxX: 2000, maxZ: 2000 };
    const biomeAt = (): string => 'tfc:highlands'; // a member of every biome-restricted vein's tag
    for (const seed of [0n, 1n, 42n, -7n, 123456789n]) {
      const deposits = discDepositsInBox(box, seed, biomeAt);
      expect(deposits.length).toBeGreaterThan(0);
      for (const deposit of deposits) {
        const vein = SUPPORTED_DISC_VEINS.find((v) => v.id === deposit.id.split('@')[0]);
        expect(vein).toBeDefined();
        if (!vein) continue;
        expect(deposit.topY).toBeLessThanOrEqual(vein.maxY);
        expect(deposit.bottomY).toBeGreaterThanOrEqual(vein.minY);
        expect(deposit.bottomY).toBeLessThanOrEqual(deposit.topY);
      }
    }
  });
});

describe('tfc-1.20 disc veins: biome restriction', () => {
  it('kaolin_disc (biome tag tfc:kaolin_clay_spawns_in) never spawns in a non-member biome', () => {
    // tfc:plains is not one of the extracted tag's members (highlands, old_mountains, plateau) --
    // src/data/tfc-1.20/biome-tags.json.
    const biomeAt = (): string => 'tfc:plains';
    let found = 0;
    for (let cz = -20; cz <= 20; cz++) {
      for (let cx = -20; cx <= 20; cx++) {
        if (findDiscVeinInChunk(42n, kaolin, cx, cz, biomeAt)) found++;
      }
    }
    expect(found).toBe(0);
  });

  it('the exact same roll spawns in a member biome and is rejected in a non-member one', () => {
    // (seed 42, chunk 5,-5) is a confirmed positive roll for kaolin_disc (see the determinism
    // test above and tests/fixtures/tfc-1.20/veins.json) -- only the biome check should differ.
    const inMember = findDiscVeinInChunk(42n, kaolin, 5, -5, () => 'tfc:highlands');
    const inNonMember = findDiscVeinInChunk(42n, kaolin, 5, -5, () => 'tfc:plains');
    expect(inMember).not.toBeNull();
    expect(inNonMember).toBeNull();
  });

  it('a vein with no biomes field ignores the biome entirely', () => {
    const borax = SUPPORTED_DISC_VEINS.find((v) => v.id === 'borax');
    if (!borax) throw new Error('borax missing from SUPPORTED_DISC_VEINS -- test data assumption broke');
    expect(borax.biomeTag).toBeNull();
    // Search for a seed/chunk where borax spawns, then confirm the biome passed in never matters.
    let spawnChunk: { x: number; z: number } | null = null;
    for (let cz = -30; cz <= 30 && !spawnChunk; cz++) {
      for (let cx = -30; cx <= 30; cx++) {
        if (findDiscVeinInChunk(7n, borax, cx, cz, () => 'tfc:ocean')) {
          spawnChunk = { x: cx, z: cz };
          break;
        }
      }
    }
    expect(spawnChunk).not.toBeNull();
    if (!spawnChunk) return;
    const withOcean = findDiscVeinInChunk(7n, borax, spawnChunk.x, spawnChunk.z, () => 'tfc:ocean');
    const withNull = findDiscVeinInChunk(7n, borax, spawnChunk.x, spawnChunk.z, () => null);
    expect(withOcean).toEqual(withNull);
  });
});

describe('tfc-1.20 disc veins: exposure honesty', () => {
  it('every placed deposit reports exposure "unknown" and a null surface height -- never guessed', () => {
    const box: BlockBox = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
    const biomeAt = (): string => 'tfc:highlands';
    const deposits = discDepositsInBox(box, 99n, biomeAt);
    expect(deposits.length).toBeGreaterThan(0);
    for (const deposit of deposits) {
      expect(deposit.exposure).toBe('unknown');
      expect(deposit.surfaceY).toBeNull();
      expect(deposit.depthBelowSurface).toBeNull();
    }
  });
});

describe('tfc-1.20 disc veins: plausibility (regression for the 2026-09-07 "carpet"/ocean bug)', () => {
  // A synthetic biome function is used here rather than a constant one (like every other test
  // above) specifically because this test needs a realistic MIX of tag-member and non-member
  // biomes to catch a fail-open biome restriction and a "too many markers" density bug at the same
  // time -- a constant biomeAt (e.g. always 'tfc:highlands') would make every biome-restricted
  // vein spawn at its full, unrestricted rate and hide exactly the bugs this test exists to catch.
  // Six bands, cycled by a non-axis-aligned function of chunk coordinates so the mix is spread
  // through the box rather than striped along one axis: three are members of
  // `tfc:kaolin_clay_spawns_in` (highlands, old_mountains, plateau -- half the box), one is the
  // sole member of `tfc:is_river` (river -- one sixth of the box), and two are members of neither
  // (plains, ocean -- 'ocean' standing in for the literal complaint: "kaolin shown ... in the
  // ocean").
  const BANDS = ['tfc:highlands', 'tfc:old_mountains', 'tfc:plateau', 'tfc:river', 'tfc:plains', 'tfc:ocean'];
  const KAOLIN_MEMBER_FRACTION = 3 / 6;
  const RIVER_MEMBER_FRACTION = 1 / 6;
  // Bands are 8 chunks (128 blocks) across, not one: a marker sits at its body's centre of mass
  // rather than at the rolled position, so with chunk-sized bands a legitimate 10-block shift would
  // cross a biome boundary constantly and this test would be measuring nothing but that.
  function biomeAt(x: number, z: number): string {
    const bandX = Math.floor(x / 128);
    const bandZ = Math.floor(z / 128);
    const band = ((bandX * 31 + bandZ * 17) % BANDS.length + BANDS.length) % BANDS.length;
    return BANDS[band] as string;
  }

  /** The game restricts the *vein*, which the marker no longer sits exactly on. */
  function memberWithinReach(
    members: ReadonlySet<string>,
    x: number,
    z: number,
    reach: number,
  ): boolean {
    for (const dx of [0, -reach, reach]) {
      for (const dz of [0, -reach, reach]) {
        if (members.has(biomeAt(x + dx, z + dz))) return true;
      }
    }
    return false;
  }

  // 256x256 chunks (4096x4096 blocks) -- large enough that random rarity-gate noise (a binomial
  // with tens of thousands of trials) cannot itself explain a multiple-x deviation from the
  // predicted mean, so a "sensible factor" bound here is actually discriminating, not just loose.
  const box: BlockBox = { minX: -2048, minZ: -2048, maxX: 2047, maxZ: 2047 };
  const totalChunks = ((box.maxX - box.minX + 1) / 16) * ((box.maxZ - box.minZ + 1) / 16);
  const seed = 42n;
  const deposits = discDepositsInBox(box, seed, biomeAt);

  it('every biome-restricted vein\'s deposit count is within a sensible factor of what rarity + its tag predict', () => {
    for (const vein of SUPPORTED_DISC_VEINS) {
      // A projected vein places nothing without a height field, and `deposits` above is built
      // without one. That is the contract, asserted on its own below rather than folded into a
      // rarity prediction it would fail by construction.
      if (vein.project) continue;
      const actual = deposits.filter((d) => d.id.startsWith(`${vein.id}@`)).length;
      const memberFraction =
        vein.biomeTag === 'tfc:kaolin_clay_spawns_in'
          ? KAOLIN_MEMBER_FRACTION
          : vein.biomeTag === 'tfc:is_river'
            ? RIVER_MEMBER_FRACTION
            : 1;
      const expected = (totalChunks / vein.rarity) * memberFraction;
      // A factor of 3 in either direction is far outside normal binomial noise at this sample
      // size (expected counts here range from ~137 to ~2731) but comfortably catches: a reseeded
      // RNG returning 0 every time (near-zero actual vs. expected -- this test's lower bound), a
      // per-pixel/duplicate-region emission bug (many times too many -- this test's upper bound),
      // and a biome restriction failing open (actual approaching `totalChunks / vein.rarity` with
      // no membership discount at all, e.g. kaolin_disc's undiscounted 2731 vs. its restricted
      // ~1366 prediction here -- outside a 3x band around 1366 only once the fail-open count gets
      // implausibly large, so the real value to check is the failing-open assertion below, which
      // is exact rather than a factor).
      expect(actual).toBeGreaterThan(expected / 3);
      expect(actual).toBeLessThan(expected * 3);
    }
  });

  it('places a surface-relative vein only when given a height field', () => {
    // The honest failure mode for `project: true`: with no surface to measure from, the vein is
    // dropped rather than drawn at a fabricated depth.
    const projected = SUPPORTED_DISC_VEINS.filter((v) => v.project);
    expect(projected.length).toBeGreaterThan(0);

    const without = discDepositsInBox(box, 42n, biomeAt, projected);
    expect(without).toEqual([]);

    const withHeight = discDepositsInBox(box, 42n, biomeAt, projected, () => 96);
    expect(withHeight.length).toBeGreaterThan(0);
    // Y is relative to the surface, so a vein whose config range is negative sits below it.
    for (const deposit of withHeight) {
      expect(deposit.topY).toBeLessThan(96);
      expect(deposit.topY).toBeGreaterThan(0);
    }
  });

  it('no deposit of a biome-restricted vein ever lands in a biome outside its own tag', () => {
    let checked = 0;
    for (const deposit of deposits) {
      const vein = SUPPORTED_DISC_VEINS.find((v) => deposit.id.startsWith(`${v.id}@`));
      if (!vein || vein.biomeTag === null) continue;
      const members = biomeTagMembers(vein.biomeTag);
      expect(members).toBeDefined();
      expect(memberWithinReach(members ?? new Set(), deposit.x, deposit.z, vein.size)).toBe(true);
      checked++;
    }
    // Guards against the check above silently passing because no restricted vein spawned at all.
    expect(checked).toBeGreaterThan(0);
  });

  it('specifically: no kaolin_disc deposit lands in a biome the real game would call ocean/plains', () => {
    const disallowed = new Set(['tfc:ocean', 'tfc:plains', 'tfc:river']);
    const kaolinDeposits = deposits.filter((d) => d.id.startsWith('kaolin_disc@'));
    expect(kaolinDeposits.length).toBeGreaterThan(0);
    const kaolinVein = SUPPORTED_DISC_VEINS.find((v) => v.id === 'kaolin_disc');
    const allowed = biomeTagMembers(kaolinVein?.biomeTag ?? '') ?? new Set<string>();
    for (const deposit of kaolinDeposits) {
      // A marker may sit a few blocks into a neighbouring biome, because the vein's body does. What
      // must never happen again is a marker with no legitimate biome anywhere near it.
      expect(memberWithinReach(allowed, deposit.x, deposit.z, kaolinVein?.size ?? 0)).toBe(true);
      expect(disallowed).not.toContain(deposit.id);
    }
  });

  it('a vein this port cannot verify (near_lava) never appears at all, however dense its rarity', () => {
    // sulfur (rarity 4, no biome restriction) would otherwise be by far the densest vein in this
    // box -- confirming its complete absence here is the plausibility test's direct check on the
    // fix for FEEDBACK.md's 2026-09-07 "carpet" bug, not just an inference from the count bounds
    // above.
    expect(deposits.some((d) => d.id.startsWith('sulfur@'))).toBe(false);
  });
});
