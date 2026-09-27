#!/usr/bin/env node
/**
 * The forge catalogue for a profile, as a view over the game's own `tfc:anvil` recipes.
 *
 * Usage:
 *   node tools/build-anvil-catalogue.mjs --profile tfg --dump <dir>          # from a dump of the game's recipes
 *   node tools/build-anvil-catalogue.mjs --profile tfg --catalogue <file>    # an existing catalogue, to filter it
 *   [--keep-namespaces tools/public-namespaces.json] [--previous <anvil-recipes.json>] [--out <file>]
 *
 * With `--dump`, every entry is read from the recipe the game holds: rules, tier, input, result.
 * The dump is `outcrop-recipes.json` in `<dir>`, `{ "recipes": [{ "id", "type", "json" }, ...] }`,
 * one entry per recipe the running game holds, exported in game (by a KubeJS script, which this
 * repository does not ship: any export in that shape will do).
 *
 * With `--catalogue`, the entries of an existing catalogue are kept exactly as they are, `_meta`
 * included: it is how a catalogue is filtered without rebuilding it.
 *
 * `--keep-namespaces <file>` keeps only the recipes whose recipe id namespace is in that file's
 * `keep` list and records what it left out in `_meta.filtered` (see `filterByNamespace` in
 * `tools/lib/anvil-catalogue.mjs`). The shipped tfg catalogue is filtered with
 * `tools/public-namespaces.json`, and `tests/unit/anvil-catalogue.test.ts` fails if it is not.
 *
 * `tools/extract-tfg-anvil-recipes.mjs` is only the fallback for when there is no dump.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterByNamespace, recipeNamespace, viewFromDump } from './lib/anvil-catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const profile = arg('profile', 'tfg');
const dumpDir = arg('dump', null);
const catalogueFile = arg('catalogue', null);
const keepFile = arg('keep-namespaces', null);
const outFile = arg('out', path.join(root, 'src', 'data', profile, 'anvil-recipes.json'));

/** A path as it may be recorded in a committed file: repo-relative, or just the file name. */
const recorded = (file) => {
  const rel = path.relative(root, path.resolve(file));
  return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel.replace(/\\/g, '/');
};

if ((dumpDir === null) === (catalogueFile === null)) {
  console.error('give exactly one of --dump <dir> or --catalogue <file>');
  process.exit(1);
}

let out;
if (dumpDir !== null) {
  /** The catalogue being replaced: its short ids are kept, so saved custom recipes that name one survive. */
  const previousFile = arg('previous', path.join(root, 'src', 'data', profile, 'anvil-recipes.json'));
  const previous = fs.existsSync(previousFile) ? JSON.parse(fs.readFileSync(previousFile, 'utf8')) : null;
  const file = path.join(dumpDir, 'outcrop-recipes.json');
  if (!fs.existsSync(file)) {
    console.error(`no outcrop-recipes.json in ${dumpDir}`);
    process.exit(1);
  }
  let built;
  try {
    built = viewFromDump(JSON.parse(fs.readFileSync(file, 'utf8')).recipes ?? [], previous);
  } catch (error) {
    console.error(`  REFUSING TO WRITE THE CATALOGUE: ${error.message}`);
    process.exit(1);
  }
  out = {
    _meta: {
      source: `tools/build-anvil-catalogue.mjs: a view over the dump's tfc:anvil recipes (${path.basename(file)}).`,
      built: new Date().toISOString(),
      /*
       * Recipes the game has that this catalogue leaves out, because no rules for them could be
       * read. A dump that carries them fills them; until then they are listed, not invented.
       */
      missingRules: built.missingRules,
      counts: { total: Object.keys(built.recipes).length, missingRules: built.missingRules.length },
    },
    recipes: built.recipes,
  };
} else {
  out = JSON.parse(fs.readFileSync(catalogueFile, 'utf8'));
  if (out === null || typeof out.recipes !== 'object') {
    console.error(`${catalogueFile} is not a catalogue: it has no "recipes"`);
    process.exit(1);
  }
}

if (keepFile !== null) {
  const keep = JSON.parse(fs.readFileSync(keepFile, 'utf8')).keep;
  if (!Array.isArray(keep) || keep.length === 0) {
    console.error(`${keepFile} has no "keep" list`);
    process.exit(1);
  }
  const { recipes, removedRecipeIds } = filterByNamespace(out.recipes, keep);
  // Filtering a catalogue that was filtered before keeps the earlier record: the result is the same
  // whichever way round, and what was left out stays written down.
  const prior = out._meta?.filtered;
  const removed = [...new Set([...(prior?.removedRecipeIds ?? []), ...removedRecipeIds])].sort();
  const byNamespace = {};
  for (const id of removed) byNamespace[recipeNamespace(id)] = (byNamespace[recipeNamespace(id)] ?? 0) + 1;
  out.recipes = recipes;
  out._meta = {
    ...out._meta,
    counts: { ...out._meta?.counts, total: Object.keys(recipes).length },
    filtered: {
      by: `tools/build-anvil-catalogue.mjs --keep-namespaces ${recorded(keepFile)}`,
      rule: "a recipe is kept only if the namespace of its recipeId is in that file's keep list",
      before: prior?.before ?? Object.keys(recipes).length + removedRecipeIds.length,
      after: Object.keys(recipes).length,
      removed: Object.fromEntries(Object.entries(byNamespace).sort(([a], [b]) => a.localeCompare(b))),
      removedRecipeIds: removed,
    },
  };
}

fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
const total = Object.keys(out.recipes).length;
console.log(`  wrote ${recorded(outFile)}: ${total} recipes`);
if (out._meta?.missingRules?.length > 0) console.log(`  missing rules: ${out._meta.missingRules.slice(0, 12).join(', ')}`);
if (out._meta?.filtered !== undefined) {
  const f = out._meta.filtered;
  console.log(`  filtered: ${f.before} -> ${f.after}, removed ${JSON.stringify(f.removed)}`);
}
