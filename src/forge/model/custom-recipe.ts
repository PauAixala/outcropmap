/**
 * User-defined anvil recipes ("custom recipes", docs/FORGING-NOTES.md "Custom recipes"): a name,
 * a target work value and up to three final-step rules. No item data — the same solver serves them
 * as it does extracted recipes (docs/PLAN.md section 14). This module is pure data + validation +
 * persistence: no DOM, so it runs unchanged under Node tests (same shape as `@app/waypoints`).
 *
 * Persistence goes through `@platform/storage` under one fixed key, so a saved list survives page
 * reloads. Export/import is JSON with a kind
 * marker; import validation is deliberately strict — a malformed file is rejected as a whole with
 * structured failure info (the UI maps it to a user-visible message) rather than storing rubbish.
 */
import type { StorageAdapter } from '@platform/storage';
import type { ActionType, ForgeRule, HitStrength, RulePosition } from './types';

/** A recipe the user defined by hand. `notes` is absent (not empty string) when there is none. */
export interface CustomRecipe {
  readonly id: string;
  /** Free text, any characters — quotes and non-ASCII included. Never assumed ASCII-safe. */
  readonly name: string;
  /** Target work value the anvil sequence must land on exactly (whole numbers only). */
  readonly target: number;
  /** Final-step rules, at most CUSTOM_RECIPE_MAX_RULES of them. May be empty. */
  readonly rules: readonly ForgeRule[];
  /** Optional free-text note, any characters. Absent when there is none. */
  readonly notes?: string;
  /**
   * The version profile the recipe was made for (`tfg`, `tfc-1.20`), from the documented shape in
   * docs/FORGING-NOTES.md. Absent on records written before the field was kept. It used to be
   * stripped on every save; it is carried through now.
   */
  readonly profile?: string;
}

/** TFC recipes carry up to three rules (docs/FORGING-NOTES.md "Rules"). */
export const CUSTOM_RECIPE_MAX_RULES = 3;

/** Action types a rule may constrain — the same six as `ActionType` in ./types. */
export const RECIPE_ACTION_TYPES: readonly ActionType[] = [
  'HIT',
  'DRAW',
  'PUNCH',
  'BEND',
  'UPSET',
  'SHRINK',
];
export const RECIPE_HIT_STRENGTHS: readonly HitStrength[] = ['LIGHT', 'MEDIUM', 'HARD'];

/** Where in the final steps a rule applies — the five positions TFC supports (./types). */
export const RECIPE_RULE_POSITIONS: readonly RulePosition[] = [
  'LAST',
  'SECOND_LAST',
  'THIRD_LAST',
  'ANY',
  'NOT_LAST',
];

/** The storage key a saved list is stored under. One list per browser profile, by design. */
export const CUSTOM_RECIPES_STORAGE_KEY = 'forge:custom-recipes';

/** File format marker for exported recipe files (cf. WAYPOINT_FILE_KIND in @app/waypoints). */
export const CUSTOM_RECIPE_FILE_KIND = 'terrafirma-mapviewer-forge-recipes';
export const CUSTOM_RECIPE_FILE_VERSION = 1;

/** Generates a unique id. `crypto.randomUUID` covers Node >= 19 and every modern browser; the
 * fallback exists only for engines without it (cf. createWaypointId). */
export function createCustomRecipeId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  return `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isOneOfConst<T extends string>(ids: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (ids as readonly string[]).includes(value);
}

/** A recipe field that failed validation — part of the structured import failure info. */
export type CustomRecipeField = 'entry' | 'id' | 'name' | 'target' | 'rules' | 'notes' | 'profile';

type RecipeEntryOutcome = { readonly recipe: CustomRecipe } | { readonly field: CustomRecipeField };

/**
 * Strictly validates one unknown value as a custom recipe. Checks run in a fixed order so the same
 * input always reports the same first failing field; unknown extra properties are ignored (not
 * stored), except `profile` from the documented shape, which is kept when it is a string.
 */
export function validateCustomRecipe(raw: unknown): RecipeEntryOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { field: 'entry' };
  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.trim() === '') return { field: 'id' };
  if (typeof obj.name !== 'string' || obj.name.trim() === '') return { field: 'name' };
  // TFC work values are whole numbers; no range is enforced — the bar bounds depend on item and
  // anvil tier, which a custom recipe does not carry.
  if (typeof obj.target !== 'number' || !Number.isInteger(obj.target)) return { field: 'target' };

  const rawRules = obj.rules;
  let rules: ForgeRule[] | null = null;
  if (rawRules === undefined) {
    rules = []; // absent is fine — a recipe may have no rules at all
  } else if (!Array.isArray(rawRules) || rawRules.length > CUSTOM_RECIPE_MAX_RULES) {
    return { field: 'rules' };
  } else {
    rules = [];
    for (const item of rawRules) {
      if (typeof item !== 'object' || item === null || Array.isArray(item))
        return { field: 'rules' };
      const rule = item as Record<string, unknown>;
      if (!isOneOfConst(RECIPE_ACTION_TYPES, rule.type)) return { field: 'rules' };
      if (!isOneOfConst(RECIPE_RULE_POSITIONS, rule.position)) return { field: 'rules' };
      if (
        rule.strength !== undefined &&
        (!isOneOfConst(RECIPE_HIT_STRENGTHS, rule.strength) || rule.type !== 'HIT')
      )
        return { field: 'rules' };
      rules.push({
        type: rule.type,
        position: rule.position,
        ...(rule.strength !== undefined ? { strength: rule.strength } : {}),
      });
    }
  }

  let notes: string | undefined;
  if (obj.notes !== undefined) {
    if (typeof obj.notes !== 'string') return { field: 'notes' };
    notes = obj.notes;
  }

  let profile: string | undefined;
  if (obj.profile !== undefined) {
    if (typeof obj.profile !== 'string') return { field: 'profile' };
    profile = obj.profile;
  }

  // Conditional spread keeps `notes` absent (not undefined) when there is none, so a saved recipe
  // round-trips through JSON exactly as it was written.
  const recipe: CustomRecipe = {
    id: obj.id,
    name: obj.name,
    target: obj.target,
    rules,
    ...(notes !== undefined ? { notes } : {}),
    ...(profile !== undefined ? { profile } : {}),
  };
  return { recipe };
}

// --- the editor's three slots and the rules they cannot hold -----------------------------------

/** The positions the editor's three rows stand for, in the order the steps happen. */
export const FORM_SLOT_POSITIONS = ['THIRD_LAST', 'SECOND_LAST', 'LAST'] as const;
export type FormSlotPosition = (typeof FORM_SLOT_POSITIONS)[number];

/**
 * A saved recipe's rules, as the editor can show them: at most one rule in each of its three slots,
 * and everything else — an `ANY` or `NOT_LAST` rule, a second rule for the same step — as `extra`,
 * which the editor shows read-only and never drops.
 *
 * Until 2026-09-10 the editor let a user save exactly those, and opening such a recipe kept only
 * what fitted the three slots, solved the reduced set, and wrote it back on Update: a pickaxe-style
 * set of three became one rule, a greaves-style set became none.
 */
export interface FormRules {
  readonly slots: Readonly<Record<FormSlotPosition, ForgeRule | null>>;
  readonly extra: readonly ForgeRule[];
  /** Which original rule each slot came from, so an unchanged form writes the original back. */
  readonly origin: readonly { readonly rule: ForgeRule; readonly slot: FormSlotPosition | null }[];
}

export function splitRulesForForm(rules: readonly ForgeRule[]): FormRules {
  const slots: Record<FormSlotPosition, ForgeRule | null> = { THIRD_LAST: null, SECOND_LAST: null, LAST: null };
  const extra: ForgeRule[] = [];
  const origin: { rule: ForgeRule; slot: FormSlotPosition | null }[] = [];
  for (const rule of rules) {
    const position = rule.position;
    if ((FORM_SLOT_POSITIONS as readonly string[]).includes(position) && slots[position as FormSlotPosition] === null) {
      slots[position as FormSlotPosition] = rule;
      origin.push({ rule, slot: position as FormSlotPosition });
    } else {
      extra.push(rule);
      origin.push({ rule, slot: null });
    }
  }
  return { slots, extra, origin };
}

/**
 * The rules to solve with and to save: the original list, in its original order, with each slotted
 * rule replaced by what the slot holds now (or dropped if the slot was cleared), every extra rule
 * kept as it was, and rules in slots that were empty appended. An untouched form gives back exactly
 * the rules it was opened with.
 */
export function rulesFromForm(
  opened: FormRules | null,
  now: Readonly<Record<FormSlotPosition, ForgeRule | null>>,
): ForgeRule[] {
  const out: ForgeRule[] = [];
  const used = new Set<FormSlotPosition>();
  for (const { rule, slot } of opened?.origin ?? []) {
    if (slot === null) {
      out.push(rule);
      continue;
    }
    used.add(slot);
    const current = now[slot];
    if (current === null) continue;
    out.push(sameRule(current, rule) ? rule : current);
  }
  for (const slot of FORM_SLOT_POSITIONS) {
    const current = now[slot];
    if (!used.has(slot) && current !== null) out.push(current);
  }
  return out;
}

function sameRule(a: ForgeRule, b: ForgeRule): boolean {
  return a.type === b.type && a.position === b.position && a.strength === b.strength;
}

// --- storage that never loses a record ---------------------------------------------------------

/**
 * What is saved: the recipes that validate, and every stored entry that does not, **verbatim**.
 *
 * The load used to drop what it could not validate -- a string rule, four rules, a fractional
 * target, a missing id -- and the next save or delete wrote the filtered list back, so the record
 * was gone for good without a word. Now an unreadable entry stays in storage exactly as it was and
 * the page says how many there are.
 */
export interface CustomRecipeStore {
  readonly recipes: CustomRecipe[];
  readonly unreadable: readonly { readonly raw: unknown; readonly field: CustomRecipeField }[];
}

export async function loadCustomRecipeStore(storage: StorageAdapter): Promise<CustomRecipeStore> {
  const raw = await storage.get<unknown>(CUSTOM_RECIPES_STORAGE_KEY);
  if (raw === undefined || raw === null) return { recipes: [], unreadable: [] };
  // A value that is not a list at all is kept too, as one unreadable entry.
  if (!Array.isArray(raw)) return { recipes: [], unreadable: [{ raw, field: 'entry' }] };
  const recipes: CustomRecipe[] = [];
  const unreadable: { raw: unknown; field: CustomRecipeField }[] = [];
  for (const item of raw) {
    const outcome = validateCustomRecipe(item);
    if ('recipe' in outcome) recipes.push(outcome.recipe);
    else unreadable.push({ raw: item, field: outcome.field });
  }
  return { recipes, unreadable };
}

/** Saves the recipes and puts every unreadable entry back exactly as it was read. */
export async function saveCustomRecipeStore(storage: StorageAdapter, store: CustomRecipeStore): Promise<void> {
  // A stored value that was not a list at all becomes one element of the list: its content is
  // kept verbatim, and the next load reports it as unreadable like any other.
  await storage.set(CUSTOM_RECIPES_STORAGE_KEY, [...store.recipes, ...store.unreadable.map((entry) => entry.raw)]);
}

/** Strict single-recipe validation; `null` when the value is not a usable custom recipe. */
export function normalizeCustomRecipe(raw: unknown): CustomRecipe | null {
  const outcome = validateCustomRecipe(raw);
  return 'recipe' in outcome ? outcome.recipe : null;
}

/**
 * Loads the saved list. Defensive by design (cf. loadWaypoints): a corrupted entry is dropped, an
 * unrecognised top-level shape degrades to an empty list — never a crash. The strict whole-file
 * policy lives on the import path (`parseCustomRecipesFile`).
 */
export async function loadCustomRecipes(storage: StorageAdapter): Promise<CustomRecipe[]> {
  const raw = await storage.get<unknown>(CUSTOM_RECIPES_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  const result: CustomRecipe[] = [];
  for (const item of raw) {
    const recipe = normalizeCustomRecipe(item);
    if (recipe !== null) result.push(recipe);
  }
  return result;
}

export async function saveCustomRecipes(
  storage: StorageAdapter,
  recipes: readonly CustomRecipe[],
): Promise<void> {
  await storage.set(CUSTOM_RECIPES_STORAGE_KEY, [...recipes]);
}

/** Serialises a list for export as a JSON file (pretty-printed; names keep every character). */
export function serializeCustomRecipes(recipes: readonly CustomRecipe[]): string {
  return JSON.stringify(
    { kind: CUSTOM_RECIPE_FILE_KIND, version: CUSTOM_RECIPE_FILE_VERSION, recipes: [...recipes] },
    null,
    2,
  );
}

/** What went wrong with an imported file — the UI maps each case to a user-visible message. */
export type CustomRecipesFailure =
  | { readonly kind: 'invalid-json' }
  | { readonly kind: 'wrong-shape' }
  | { readonly kind: 'bad-recipe'; readonly index: number; readonly field: CustomRecipeField };

export type ParseCustomRecipesResult =
  | { readonly ok: true; readonly recipes: readonly CustomRecipe[] }
  | { readonly ok: false; readonly failure: CustomRecipesFailure };

/**
 * Parses text produced by `serializeCustomRecipes` (or a bare JSON array of recipe objects — the
 * friendly path, cf. parseWaypointsJson) back into a list. Strict on purpose: the first invalid
 * entry fails the whole file with its index and field, so one bad line never quietly becomes part
 * of the saved set. `version` is accepted as-is (forward compatibility).
 */
export function parseCustomRecipesFile(text: string): ParseCustomRecipesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, failure: { kind: 'invalid-json' } };
  }

  let entries: readonly unknown[];
  if (Array.isArray(parsed)) {
    entries = parsed;
  } else if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (obj.kind !== CUSTOM_RECIPE_FILE_KIND || !Array.isArray(obj.recipes)) {
      return { ok: false, failure: { kind: 'wrong-shape' } };
    }
    entries = obj.recipes;
  } else {
    return { ok: false, failure: { kind: 'wrong-shape' } };
  }

  const recipes: CustomRecipe[] = [];
  for (let i = 0; i < entries.length; i++) {
    const outcome = validateCustomRecipe(entries[i]);
    if (!('recipe' in outcome))
      return { ok: false, failure: { kind: 'bad-recipe', index: i, field: outcome.field } };
    recipes.push(outcome.recipe);
  }
  return { ok: true, recipes };
}
