/**
 * The forge catalogue as a view over the game's own `tfc:anvil` recipes.
 *
 * **From a dump** (`viewFromDump`): every `tfc:anvil` recipe the game holds, with the `rules`,
 * `tier`, `input` and `result` its json carries. Nothing is inferred. A recipe without rules means
 * the dump lost them, and the build stops rather than writing a catalogue that would send a player
 * through the wrong sequence.
 *
 * A catalogue entry keeps its short `id` from the previous catalogue when the recipe id is the same,
 * so saved custom recipes that name it survive; a new entry takes the name after `anvil/`,
 * namespaced only where that would collide. `recipeId` is always the game's own id with its own
 * namespace, because the id seeds the target work (`anvilTargetWork`) — `waterflasks:`, not `tfc:`.
 *
 * **Filtered by namespace** (`filterByNamespace`): only the recipes whose recipe id namespace is on
 * a keep list, which is how the shipped catalogue leaves out data whose licence does not allow
 * publishing it (`tools/public-namespaces.json`).
 */
import fs from 'node:fs';
import path from 'node:path';

/** `#tag` or an item id from a json ingredient, as the catalogue's `{ item | tag }`. */
function asIngredient(id) {
  return id.startsWith('#') ? { tag: id.slice(1) } : { item: id };
}

/** The first id an ingredient json names: enough for a catalogue, which shows one input. */
function firstId(node) {
  if (node === null || node === undefined) return null;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const one of node) {
      const id = firstId(one);
      if (id !== null) return id;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (node.item !== undefined) return typeof node.item === 'object' ? firstId(node.item) : String(node.item);
  if (node.tag !== undefined) return `#${node.tag}`;
  for (const key of ['stack', 'ingredient', 'base', 'value', 'id']) {
    if (node[key] !== undefined) {
      const id = firstId(node[key]);
      if (id !== null) return id;
    }
  }
  return null;
}

function countOf(node) {
  if (node && typeof node === 'object') {
    if (node.stack) return countOf(node.stack);
    if (typeof node.count === 'number') return node.count;
  }
  return 1;
}

/** Short ids of the previous catalogue, by recipe id, so a saved recipe that names one survives. */
function previousIds(previous) {
  const byRecipe = new Map();
  for (const entry of Object.values(previous?.recipes ?? {})) {
    if (typeof entry.recipeId !== 'string') continue;
    const had = byRecipe.get(entry.recipeId);
    // Two entries for one recipe id: keep the one that is not namespace-prefixed.
    if (had === undefined || entry.id.length < had.length) byRecipe.set(entry.recipeId, entry.id);
  }
  return byRecipe;
}

function shortIdFor(recipeId, taken, previous) {
  const kept = previous.get(recipeId);
  if (kept !== undefined && !taken.has(kept)) return kept;
  const ns = recipeId.slice(0, recipeId.indexOf(':'));
  const name = recipeId.slice(recipeId.indexOf('anvil/') + 'anvil/'.length).replace(/\//g, '_');
  // Namespaced only where it would collide, so existing ids and their saved recipes survive.
  if (!taken.has(name)) return name;
  const namespaced = `${ns}_${name}`;
  if (!taken.has(namespaced)) return namespaced;
  let n = 2;
  while (taken.has(`${namespaced}_${n}`)) n++;
  return `${namespaced}_${n}`;
}

function sortedRecipes(entries) {
  return Object.fromEntries(entries.sort((a, b) => a.id.localeCompare(b.id)).map((entry) => [entry.id, entry]));
}

/**
 * The catalogue from a dump's recipes (`outcrop-recipes.json`). Throws, naming them, if any
 * `tfc:anvil` recipe has no rules — the one thing the forge cannot do without.
 */
export function viewFromDump(dumpRecipes, previous) {
  const kept = previousIds(previous);
  const taken = new Set();
  const out = [];
  const noRules = [];
  for (const recipe of dumpRecipes) {
    if (recipe.type !== 'tfc:anvil') continue;
    const json = typeof recipe.json === 'string' ? JSON.parse(recipe.json) : recipe.json;
    const rules = Array.isArray(json?.rules) ? json.rules.map(String) : null;
    if (rules === null || rules.length === 0) {
      noRules.push(recipe.id);
      continue;
    }
    const input = firstId(json.input);
    const result = firstId(json.result);
    if (input === null || result === null) {
      noRules.push(`${recipe.id} (no readable input or result)`);
      continue;
    }
    const id = shortIdFor(recipe.id, taken, kept);
    taken.add(id);
    const count = countOf(json.result);
    out.push({
      id,
      recipeId: recipe.id,
      input: asIngredient(input),
      result: count > 1 ? { item: result, count } : { item: result },
      // TFC's own default when a recipe names none: -1, "any anvil" (AnvilRecipe.java line 192).
      tier: typeof json.tier === 'number' ? json.tier : -1,
      rules,
    });
  }
  if (noRules.length > 0) {
    throw new Error(`${noRules.length} tfc:anvil recipe(s) in the dump have no rules: ${noRules.slice(0, 10).join(', ')}`);
  }
  return { recipes: sortedRecipes(out), missingRules: [] };
}

/** `createdeco:anvil/brass_trapdoor` -> `createdeco`. */
export function recipeNamespace(recipeId) {
  const colon = recipeId.indexOf(':');
  return colon < 0 ? 'minecraft' : recipeId.slice(0, colon);
}

/**
 * The catalogue's recipes whose recipe id namespace is in `keep`, and the recipe ids it left out.
 *
 * The namespace of the *recipe id* is who wrote the recipe, which is whose data the entry is: a
 * TerraFirmaGreg script that makes a Create Deco door writes `tfg:anvil/...`, and naming an item is
 * not copying it. A namespace missing from `keep` is left out, whatever its reason: dropped, unsure
 * or never reviewed. Entries that stay are untouched, short ids included.
 */
export function filterByNamespace(recipes, keep) {
  const allowed = new Set(keep);
  const kept = {};
  const removedRecipeIds = [];
  for (const [key, entry] of Object.entries(recipes)) {
    if (allowed.has(recipeNamespace(entry.recipeId))) kept[key] = entry;
    else removedRecipeIds.push(entry.recipeId);
  }
  return { recipes: kept, removedRecipeIds: removedRecipeIds.sort() };
}

/**
 * TerraFirmaGreg's per-material part families, read from the script that defines them rather than
 * transcribed: `recipes.material_tag_prefixes.js`, each
 * `addAnvilRecipe(event, <output>[.withCount(n)], <input>, [rules], bonus, material, '<suffix>')`,
 * which registers `tfc:anvil/<material>_<suffix>` (see `addAnvilRecipe` in the same file).
 */
export function scriptFamilies(tfgRoot) {
  const file = path.join(tfgRoot, 'kubejs/server_scripts/tfg/ores_and_materials/recipes.material_tag_prefixes.js');
  if (!fs.existsSync(file)) return new Map();
  const text = fs.readFileSync(file, 'utf8');
  const families = new Map();
  const call =
    /addAnvilRecipe\(\s*event,\s*(\w+)(?:\.withCount\((\d+)\))?,\s*(\w+),\s*\[([^\]]*)\],\s*(?:true|false),\s*material,\s*'(\w+)'\s*\)/g;
  for (const m of text.matchAll(call)) {
    families.set(m[5], {
      rules: m[4].split(',').map((r) => r.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return families;
}
