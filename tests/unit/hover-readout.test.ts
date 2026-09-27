/**
 * Unit tests for the hover readout's pure formatter: grouping into
 * Position/Climate/Geology/Deposits, and — the one rule that actually matters here — every field
 * the generator could not answer renders as an em dash, never the string "null" or "undefined".
 */
import { describe, expect, it } from 'vitest';
import { buildReadoutGroups } from '../../src/ui/components/panels';
import type { Probe, TerrainSample } from '../../src/worldgen/api/types';

const NO_VALUE = '—';

const FULL_TERRAIN: TerrainSample = {
  land: true,
  island: false,
  mountain: true,
  coastalMountain: false,
  distanceToOcean: 12,
  distanceToEdge: 34,
  baseLandHeight: 5,
  biomeAltitude: 2,
};

const FULL_PROBE: Probe = {
  x: 100.4,
  z: -50.9,
  chunkX: 6,
  chunkZ: -4,
  regionX: 1,
  regionZ: -1,
  regionDebug: { id: '1,-1', centerX: 12288, centerZ: -12288 },
  biome: 'tfc:plains',
  climate: { temperature: 14.567, rainfall: 250.4 },
  rocks: { top: 'granite', middle: 'diorite', bottom: 'gabbro', surface: 'granite' },
  terrain: FULL_TERRAIN,
  surfaceY: 92,
};

/** Every field a fast probe leaves unavailable because its region has not been built yet
 * (`WorldGenerator.probeFast`) — position fields are always cheap, so those stay filled in. */
const COLD_PROBE: Probe = {
  x: 100,
  z: -50,
  chunkX: 6,
  chunkZ: -4,
  regionX: 1,
  regionZ: -1,
  regionDebug: { id: '1,-1', centerX: 12288, centerZ: -12288 },
  biome: null,
  climate: null,
  rocks: null,
  terrain: null,
  surfaceY: null,
};

function allValues(groups: ReturnType<typeof buildReadoutGroups>): string[] {
  return groups.flatMap((g) => g.rows.map((r) => r.value));
}

/**
 * Groups are looked up by heading rather than by index. Positional destructuring silently pointed
 * these assertions at the wrong group when a group was added, and would do it again on removal.
 */
function groupNamed(
  groups: readonly { heading: string; rows: readonly { label: string; value: string }[]; emptyNote?: string }[],
  heading: string,
): (typeof groups)[number] | undefined {
  return groups.find((g) => g.heading === heading);
}

describe('buildReadoutGroups: grouping', () => {
  it('produces exactly the four named groups, in order: Position, Climate, Geology, Deposits', () => {
    const groups = buildReadoutGroups(FULL_PROBE);
    expect(groups.map((g) => g.heading)).toEqual(['Position', 'Climate', 'Geology', 'Deposits']);
  });

  it('Position carries block and chunk', () => {
    const position = groupNamed(buildReadoutGroups(FULL_PROBE), 'Position');
    const labels = position?.rows.map((r) => r.label) ?? [];
    expect(labels).toContain('Block');
    expect(labels).toContain('Chunk');
    const block = position?.rows.find((r) => r.label === 'Block');
    // Math.floor, not a raw fractional block coordinate.
    expect(block?.value).toBe('100, -51');
  });

  it('Climate carries temperature in °C and rainfall in mm', () => {
    const [, climate] = buildReadoutGroups(FULL_PROBE);
    const rows = climate?.rows ?? [];
    expect(rows.find((r) => r.label === 'Temperature')?.value).toBe('14.6 °C');
    expect(rows.find((r) => r.label === 'Rainfall')?.value).toBe('250 mm');
  });

  it('Geology carries the rock stack, the rock at the surface, and land/ocean', () => {
    const geology = groupNamed(buildReadoutGroups(FULL_PROBE), 'Geology');
    const rows = geology?.rows ?? [];
    const labels = rows.map((r) => r.label);
    expect(labels.some((l) => l.includes('Top'))).toBe(true);
    expect(labels.some((l) => l.includes('Middle'))).toBe(true);
    expect(labels.some((l) => l.includes('Bottom'))).toBe(true);
    expect(labels.some((l) => l.includes('At surface'))).toBe(true);
    expect(rows.find((r) => r.label === 'Land / ocean')?.value).toBe('Land');
  });

  it('Deposits is empty and carries an explicit note, never fabricated content', () => {
    const deposits = groupNamed(buildReadoutGroups(FULL_PROBE), 'Deposits');
    expect(deposits?.rows).toEqual([]);
    expect(deposits?.emptyNote).toBeTruthy();
  });

  it('shows the region centre only when region-debug is requested and available', () => {
    const withoutDebug = buildReadoutGroups(FULL_PROBE, false);
    const withDebug = buildReadoutGroups(FULL_PROBE, true);
    const hasCentre = (groups: ReturnType<typeof buildReadoutGroups>): boolean =>
      groups.some((g) => g.rows.some((r) => r.label === 'Region centre'));
    expect(hasCentre(withoutDebug)).toBe(false);
    expect(hasCentre(withDebug)).toBe(true);
  });
});

describe('buildReadoutGroups: null rendering (the one rule that matters)', () => {
  it('renders an em dash for every field a cold fast-probe left null', () => {
    const groups = buildReadoutGroups(COLD_PROBE);
    const values = allValues(groups);
    // Position is always cheap and therefore never null except distance-to-edge, which needs
    // terrain — assert everything else that *should* be missing actually reads as unavailable.
    const climate = groupNamed(groups, 'Climate');
    const geology = groupNamed(groups, 'Geology');
    for (const row of climate?.rows ?? []) {
      expect(row.value).toBe(NO_VALUE);
    }
    const geologyLabelsExpectedMissing = [
      'Biome',
      'Land / ocean',
      'Rock: Top',
      'Rock: Middle',
      'Rock: Bottom',
      'Rock: At surface',
    ];
    for (const label of geologyLabelsExpectedMissing) {
      const row = geology?.rows.find((r) => r.label === label);
      expect(row, `missing row for "${label}"`).toBeDefined();
      expect(row?.value).toBe(NO_VALUE);
    }
    // Never the string "null" or "undefined" anywhere, under any label.
    for (const value of values) {
      expect(value.toLowerCase()).not.toContain('null');
      expect(value.toLowerCase()).not.toContain('undefined');
    }
  });

  it('never renders "null" or "undefined" even for a fully-populated probe', () => {
    const values = allValues(buildReadoutGroups(FULL_PROBE, true));
    for (const value of values) {
      expect(value.toLowerCase()).not.toContain('null');
      expect(value.toLowerCase()).not.toContain('undefined');
    }
  });

  it('a partially-cold probe (fast path found the region already cached but rocks unavailable) mixes real values and em dashes correctly', () => {
    const partial: Probe = { ...FULL_PROBE, rocks: null, surfaceY: null };
    const geology = groupNamed(buildReadoutGroups(partial), 'Geology');
    expect(geology?.rows.find((r) => r.label === 'Rock: Top')?.value).toBe(NO_VALUE);
    // But the fields that were still available are not blanked out too.
    expect(geology?.rows.find((r) => r.label === 'Land / ocean')?.value).toBe('Land');
    expect(geology?.rows.find((r) => r.label === 'Biome')?.value).not.toBe(NO_VALUE);
  });
});
