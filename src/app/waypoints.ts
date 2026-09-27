/**
 * Waypoints — markers the user places on a generated world (his house, a mine, ...) and edits in
 * the side panel (docs/PLAN.md section 10b). This module is pure data + persistence: no DOM, so it
 * runs unchanged under Node tests. The canvas drawing lives in `@render/canvas2d/waypoints` and the
 * panel UI in `@ui/components/waypoint-panel`.
 *
 * Persistence goes through `@platform/storage`, keyed by **seed and profile** (a marker set belongs
 * to a world, not to a camera position), so it survives reloads.
 * Waypoints deliberately do *not* ride along in the shareable URL hash: a
 * large set would bloat permalinks (docs/PLAN.md 10b open question) — export/import below is how a
 * set gets shared instead.
 */
import type { ProfileId } from '@worldgen/api/types';
import type { StorageAdapter } from '@platform/storage';
import type { MapState, Store } from '@app/state';

/** The small built-in icon set (docs/PLAN.md 10b). Original shapes drawn in code — no game assets. */
export const WAYPOINT_ICONS = ['house', 'mine', 'portal', 'flag', 'star', 'question'] as const;
export type WaypointIcon = (typeof WAYPOINT_ICONS)[number];

/**
 * Marker colours are theme tokens, not hex values (ADR 0005): each entry is the name of a CSS
 * custom property declared in `src/ui/styles/base.css` and resolved through `@ui/theme`. A
 * waypoint's `colour` field stores one of these names, so exported JSON stays portable across
 * themes without baking in any pixel value.
 */
export const WAYPOINT_COLOURS = ['wp-red', 'wp-orange', 'wp-green', 'wp-blue', 'wp-purple', 'wp-pink'] as const;
export type WaypointColour = (typeof WAYPOINT_COLOURS)[number];

/** One user-placed marker. `x`/`z` are block coordinates (fractional values allowed). */
export interface Waypoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  /** Free text, any characters — quotes and non-ASCII included. Never assumed ASCII-safe. */
  readonly label: string;
  readonly colour: WaypointColour;
  readonly icon: WaypointIcon;
}

/** A waypoint without its (generated) id: what the panel collects before one exists. */
export type NewWaypoint = Omit<Waypoint, 'id'>

function isOneOfConst<T extends string>(ids: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (ids as readonly string[]).includes(value);
}

/** Generates a unique id. `crypto.randomUUID` covers Node >= 19 and every modern browser; the
 * fallback exists only for engines without it, where a timestamp+random mix is good enough for ids
 * that never leave this machine's storage except via explicit export. */
export function createWaypointId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Defensively coerces one unknown value into a valid waypoint. Returns `null` when the value is not
 * an object with finite numeric coordinates (nothing to point at), and falls back rather than
 * failing on every other field: a missing id gets generated, an unknown colour/icon snaps to its
 * default, a non-string label becomes ''. Used for both corrupted storage reads and imported files,
 * so garbage in the wild degrades to "dropped or defaulted", never a crash.
 */
export function normalizeWaypoint(raw: unknown): Waypoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.x !== 'number' || !Number.isFinite(obj.x)) return null;
  if (typeof obj.z !== 'number' || !Number.isFinite(obj.z)) return null;
  const id = typeof obj.id === 'string' && obj.id !== '' ? obj.id : createWaypointId();
  return {
    id,
    x: obj.x,
    z: obj.z,
    label: typeof obj.label === 'string' ? obj.label : '',
    colour: isOneOfConst(WAYPOINT_COLOURS, obj.colour) ? obj.colour : WAYPOINT_COLOURS[0]!,
    icon: isOneOfConst(WAYPOINT_ICONS, obj.icon) ? obj.icon : WAYPOINT_ICONS[0]!,
  };
}

/** Coerces an unknown value into a waypoint list. Non-arrays become []; invalid entries are
 * dropped and duplicate ids collapse to the first occurrence (imports may overlap the current set). */
export function normalizeWaypoints(raw: unknown): Waypoint[] {
  if (!Array.isArray(raw)) return [];
  const result: Waypoint[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const wp = normalizeWaypoint(item);
    if (wp !== null && !seen.has(wp.id)) {
      seen.add(wp.id);
      result.push(wp);
    }
  }
  return result;
}

/** The storage key a waypoint list is saved under: seed and profile only, by design. */
export function waypointStorageKey(seed: bigint, profile: ProfileId): string {
  return `waypoints:${seed.toString()}:${profile}`;
}

export async function loadWaypoints(
  storage: StorageAdapter,
  seed: bigint,
  profile: ProfileId,
): Promise<Waypoint[]> {
  const raw = await storage.get<unknown>(waypointStorageKey(seed, profile));
  return normalizeWaypoints(raw);
}

export async function saveWaypoints(
  storage: StorageAdapter,
  seed: bigint,
  profile: ProfileId,
  waypoints: readonly Waypoint[],
): Promise<void> {
  await storage.set(waypointStorageKey(seed, profile), [...waypoints]);
}

/**
 * File format marker for exported sets. `seed`/`profile` are recorded as provenance (which world
 * the set was exported from) but are ignored on import: importing merges into whatever world is
 * currently loaded, so a shared file stays useful without being locked to one seed.
 */
export const WAYPOINT_FILE_KIND = 'terrafirma-mapviewer-waypoints';

/** Serialises a list for export as a JSON file (pretty-printed; labels keep every character). */
export function serializeWaypoints(
  waypoints: readonly Waypoint[],
  meta: { readonly seed: bigint; readonly profile: ProfileId },
): string {
  return JSON.stringify(
    {
      kind: WAYPOINT_FILE_KIND,
      version: 1,
      seed: meta.seed.toString(),
      profile: meta.profile,
      waypoints: [...waypoints],
    },
    null,
    2,
  );
}

/**
 * Parses text produced by `serializeWaypoints` (or a bare JSON array of waypoint objects) back into
 * a list. Returns `null` only when the text is not JSON at all or carries an unrecognised shape;
 * individual malformed entries are dropped by `normalizeWaypoints` instead of failing the whole
 * file, so one bad line never destroys the rest of a shared set.
 */
export function parseWaypointsJson(text: string): Waypoint[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return normalizeWaypoints(parsed);
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (obj.kind !== WAYPOINT_FILE_KIND) return null;
    return Array.isArray(obj.waypoints) ? normalizeWaypoints(obj.waypoints) : [];
  }
  return null;
}

/**
 * The one place waypoint mutations happen: every operation updates the store *and* persists under
 * the current session's storage key, so state and storage can never drift apart (the alternative —
 * saving from a store subscription — races with the async load on seed changes). All methods are
 * synchronous; the storage write is fire-and-forget by design (a full or failed quota must not
 * block the map), which keeps this module free of unhandled rejections under Node tests too.
 */
export interface WaypointController {
  /** Appends a new waypoint (id generated) and persists the resulting list. */
  add(input: NewWaypoint): void;
  /** Patches one waypoint by id (label, coordinates, colour or icon) and persists. */
  update(id: string, patch: Partial<NewWaypoint>): void;
  /** Removes one waypoint by id and persists the remaining list. */
  remove(id: string): void;
  /** Replaces the whole list. `persist` defaults to true; session loads pass false for the
   * immediate clear so a stale world's markers never overwrite a fresh world's saved set. */
  setList(list: readonly Waypoint[], persist?: boolean): void;
}

export function createWaypointController(store: Store<MapState>, storage: StorageAdapter): WaypointController {
  const current = (): readonly Waypoint[] => store.getState().waypoints ?? [];

  function saveNow(waypoints: readonly Waypoint[]): void {
    try {
      const state = store.getState();
      void saveWaypoints(storage, state.seed, state.profile, waypoints).catch(() => {
        // Storage failure (quota, private browsing) is non-fatal: the in-memory list stays
        // correct for this session and simply does not survive a reload.
      });
    } catch {
      // Same as above — the web adapter's set() can throw synchronously on quota overflow.
    }
  }

  return {
    add(input): void {
      const wp = normalizeWaypoint({ ...input, id: createWaypointId() });
      if (wp === null) return; // non-finite coordinates from a caller bug — refuse rather than mark nothing
      const list = [...current(), wp];
      store.setState({ waypoints: list });
      saveNow(list);
    },
    update(id, patch): void {
      const list = current().map((wp) => (wp.id === id ? normalizeWaypoint({ ...wp, ...patch }) ?? wp : wp));
      store.setState({ waypoints: list });
      saveNow(list);
    },
    remove(id): void {
      const list = current().filter((wp) => wp.id !== id);
      store.setState({ waypoints: list });
      saveNow(list);
    },
    setList(list, persist = true): void {
      const normalized = normalizeWaypoints(list);
      store.setState({ waypoints: normalized });
      if (persist) saveNow(normalized);
    },
  };
}
