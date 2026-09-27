/**
 * Distance measuring (docs/PLAN.md 10d P1). Pure data and arithmetic — no DOM, no canvas — so it
 * runs unchanged in a Node test.
 *
 * One tool covers all three cases the user asked for. The first click sets the start; until the
 * second click the end follows the cursor, which is the live "how far is this from my base"
 * readout. Both ends snap to a nearby waypoint, so base-to-mine is two clicks and no typing.
 */

export interface MeasurePoint {
  readonly x: number;
  readonly z: number;
  /** Set when this end snapped to a waypoint, for the label. */
  readonly label?: string;
}

export interface Measurement {
  /** Straight-line distance in blocks. */
  readonly blocks: number;
  /** Per-axis separation — what the player reads off F3. */
  readonly dx: number;
  readonly dz: number;
  /** Straight-line distance in chunks (16 blocks). */
  readonly chunks: number;
  /**
   * Rough travel times in seconds. **Estimates, and the UI must say so**: they assume flat ground
   * and no obstacles, and ignore terrain, gear, mounts and mods (AGENTS.md section 2 — an
   * approximation is allowed, presenting it as exact is not).
   */
  readonly walkSeconds: number;
  readonly sprintSeconds: number;
}

/**
 * Vanilla movement speeds in blocks per second, which TerraFirmaCraft does not change for a player
 * on flat ground. Stated here rather than buried in a formula so the assumption is reviewable.
 */
export const WALK_BLOCKS_PER_SECOND = 4.317;
export const SPRINT_BLOCKS_PER_SECOND = 5.612;

const BLOCKS_PER_CHUNK = 16;

export function measureBetween(a: MeasurePoint, b: MeasurePoint): Measurement {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const blocks = Math.hypot(dx, dz);
  return {
    blocks,
    dx,
    dz,
    chunks: blocks / BLOCKS_PER_CHUNK,
    walkSeconds: blocks / WALK_BLOCKS_PER_SECOND,
    sprintSeconds: blocks / SPRINT_BLOCKS_PER_SECOND,
  };
}

/** "7 min", "45 s", "1 h 12 min" — coarse on purpose, because the input is an estimate. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return '0 s';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Thousands-separated whole blocks. */
export function formatBlocks(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
