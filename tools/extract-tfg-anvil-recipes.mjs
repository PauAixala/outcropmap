#!/usr/bin/env node
/**
 * TerraFirmaGreg's anvil recipe catalogue: TFC's own recipe JSON, then every recipe TerraFirmaGreg's
 * KubeJS scripts add or override, into src/data/tfg/anvil-recipes.json.
 *
 * **The fallback, not the source.** The catalogue is a view over the game's own `tfc:anvil`
 * recipes, `tools/build-anvil-catalogue.mjs --dump <dir>`, whenever there is a dump. This script is
 * for when there is none, and it reads only what the files say: it can list a recipe the game does
 * not have, or miss one the game generates, so check what it writes before shipping it. Filter its
 * output like the shipped catalogue (`tools/build-anvil-catalogue.mjs --catalogue <file>
 * --keep-namespaces tools/public-namespaces.json`); `tests/unit/anvil-catalogue.test.ts` fails if
 * that step is skipped.
 *
 * Usage: node tools/extract-tfg-anvil-recipes.mjs [--tfc "$HOME/reference/tfc"] [--tfg "$HOME/reference/tfg"]
 *                                                  [--instance "<instance>"] [--mods "<instance>/mods"]
 *                                                  [--world "<instance>/saves/<save>"]
 *
 * Why this exists: TFG defines most of its anvil recipes in KubeJS, and several reuse TFC's recipe
 * ids with different rules — so a catalogue built from TFC's JSON alone both missed recipes (the
 * mining hammer head, the spade head…) and showed the wrong rules for others (sword, knife and
 * scythe blades).
 *
 * What is read, exactly as the scripts state it:
 * - `processTFCTool` / `processTFCArmor` (`recipes.material_tfc.js`): run for every material flagged
 *   HAS_TFC_TOOL / HAS_TFC_ARMOR in `material_modification.flags.js`, at the tier its TFC_PROPERTY
 *   declares in `material_modification.tfc.js`. (HAS_GT_TOOL also triggers `processTFCTool`, but no
 *   script or jar assigns it to any material.)
 * - Literal `event.recipes.tfc.anvil(...)` calls in the other server scripts, with the small literal
 *   arrays some of them loop over.
 *
 * What is deliberately **not** read: the per-material GregTech part recipes in
 * `recipes.material_tag_prefixes.js` (sheet, rod, bolt, screw, ring, spring, nugget, small gear…).
 * Each is skipped at runtime unless GregTech generated that part for that material, and which parts
 * exist is decided by GregTech's Java material registry, not by any file here. Listing them would be
 * guessing. They are reported in `_meta.omitted` instead.
 *
 * Result items that GregTech generates at runtime (a steel mining hammer head, say) have no id
 * visible in any script. Their `result.item` is written in TFC's `metal/<part>/<material>` shape so
 * the UI can name and draw them, and flagged `displayOnly` — it names the item, it is not its
 * registry id.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { scriptFamilies } from './lib/anvil-catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
/*
 * The instance is optional here: without one, the other mods' anvil recipes (section 4) and the
 * per-material parts (section 5) are skipped with a warning. `--instance` or OUTCROP_INSTANCE; there
 * is no default, because the last one was a folder on one person's second drive.
 */
const instance = arg('instance', undefined) ?? process.env.OUTCROP_INSTANCE ?? null;
const tfcRoot = arg('tfc', path.join(os.homedir(), 'reference/tfc'));
const tfgRoot = arg('tfg', path.join(os.homedir(), 'reference/tfg'));
const scripts = path.join(tfgRoot, 'kubejs/server_scripts');
const startup = path.join(tfgRoot, 'kubejs/startup_scripts');
const read = (file) => fs.readFileSync(file, 'utf8');
const snake = (camel) => camel.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const recipes = {};
const sources = {};

// --- 1. TFC's own recipe JSON ---------------------------------------------------------------------
const tfcDir = path.join(tfcRoot, 'src/main/resources/data/tfc/recipes/anvil');
for (const file of fs.readdirSync(tfcDir).filter((f) => f.endsWith('.json')).sort()) {
  const data = JSON.parse(read(path.join(tfcDir, file)));
  const id = file.replace(/\.json$/, '');
  recipes[id] = { id, recipeId: `tfc:anvil/${id}`, input: data.input ?? null, result: data.result ?? null, tier: data.tier ?? 0, rules: data.rules ?? [] };
  sources[id] = 'tfc';
}
const tfcCount = Object.keys(recipes).length;

// --- 2. Materials, flags and tiers ------------------------------------------------------------------
const flagsText = read(path.join(startup, 'tfg/materials/material_modification.flags.js'));
const materialsWith = (flag) =>
  [...flagsText.matchAll(/GTMaterials\.(\w+)\.addFlags\(([^)]*)\)/g)]
    .filter((m) => new RegExp(`\\b${flag}\\b`).test(m[2]))
    .map((m) => snake(m[1]));
const toolMaterials = materialsWith('HAS_TFC_TOOL');
const armorMaterials = materialsWith('HAS_TFC_ARMOR');

const tiers = {};
for (const m of read(path.join(startup, 'tfg/materials/material_modification.tfc.js')).matchAll(
  /GTMaterials\.(\w+)\.setProperty\(TFGPropertyKey\.TFC_PROPERTY, new \$TFC_PROPERTY\(([^)]*)\)\)/g,
)) {
  // (forging temp, welding temp, melt temp, [material,] tier[, percent])
  const args = m[2].split(',').map((a) => a.trim());
  const numeric = args.slice(3).filter((a) => /^\d+$/.test(a));
  if (numeric.length > 0) tiers[snake(m[1])] = Number(numeric[0]);
}

// --- 3. processTFCTool / processTFCArmor ----------------------------------------------------------
const INPUT_TAGS = {
  ingotItem: 'forge:ingots',
  doubleIngotItem: 'forge:double_ingots',
  plateItem: 'forge:plates',
  doublePlateItem: 'forge:double_plates',
};
const materialTfc = read(path.join(scripts, 'tfg/ores_and_materials/recipes.material_tfc.js'));
function functionBody(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no function ${name}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
function perMaterialRecipes(fnName, materials) {
  const body = functionBody(materialTfc, fnName);
  // `const x = \`tfc:metal/part/${materialName}\`` or `let x = …`: result ids spelled out in the script.
  const literalOutputs = Object.fromEntries(
    [...body.matchAll(/(?:const|let)\s+(\w+)\s*=\s*`([^`]+)`/g)].map((m) => [m[1], m[2]]),
  );
  const calls = [...body.matchAll(/addAnvilRecipe\(event,\s*(\w+),\s*(\w+),\s*\[([^\]]*)\],\s*(true|false),\s*material,\s*'([^']+)'\)/g)];
  let added = 0;
  for (const material of materials) {
    const tier = tiers[material];
    if (tier === undefined) throw new Error(`no TFC_PROPERTY tier for ${material}`);
    for (const [, outputVar, inputVar, rulesText, , suffix] of calls) {
      const inputTag = INPUT_TAGS[inputVar];
      if (!inputTag) throw new Error(`unknown input ${inputVar} in ${fnName}`);
      const literal = literalOutputs[outputVar];
      const id = `${material}_${suffix}`;
      recipes[id] = {
        id,
        // addAnvilRecipe(): `.id(`tfc:anvil/${material.getName()}_${recipeIdSuffix}`)`.
        recipeId: `tfc:anvil/${id}`,
        input: { tag: `${inputTag}/${material}` },
        result: literal
          ? { item: literal.replace('${materialName}', material) }
          : { item: `tfc:metal/${suffix}/${material}`, displayOnly: true },
        tier,
        rules: rulesText.split(',').map((r) => r.trim().replace(/^'|'$/g, '')).filter(Boolean),
      };
      sources[id] = `tfg:${fnName}`;
      added++;
    }
  }
  return added;
}
const toolCount = perMaterialRecipes('processTFCTool', toolMaterials);
const armorCount = perMaterialRecipes('processTFCArmor', armorMaterials);

// --- 4. Literal event.recipes.tfc.anvil(...) calls ------------------------------------------------
function parseItem(text) {
  const m = /^(?:(\d+)x\s+)?(#?)(.+)$/.exec(text.trim());
  const count = m[1] ? Number(m[1]) : undefined;
  return m[2] ? { tag: m[3], count } : { item: m[3], count };
}
function literalArray(fileText, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(fileText);
  if (!m) return null;
  return [...m[1].matchAll(/\{([^}]*)\}/g)].map((obj) =>
    Object.fromEntries([...obj[1].matchAll(/(\w+)\s*:\s*(?:'([^']*)'|(\d+))/g)].map((kv) => [kv[1], kv[2] ?? Number(kv[3])])),
  );
}
const ANVIL_CALL =
  /event\.recipes\.tfc\.anvil\(\s*([`'"])([^`'"]+)\1\s*,\s*([`'"])([^`'"]+)\3\s*,\s*\[([^\]]*)\]\s*\)([^;]*?)\.id\(\s*([`'"])([^`'"]+)\7\s*\)/g;
let literalCount = 0;
const skipped = [];
function addLiteral(file, output, input, rulesText, chain, idText, vars = {}) {
  const fill = (t) => t.replace(/\$\{(\w+)\.(\w+)\}/g, (_, _obj, key) => {
    if (vars[key] === undefined) throw new Error(`unbound ${key}`);
    return String(vars[key]);
  });
  const recipeId = fill(idText);
  const key = recipeId.slice(recipeId.indexOf('anvil/') + 'anvil/'.length).replace(/\//g, '_');
  const tierMatch = /\.tier\(\s*(?:(\d+)|(\w+)\.tier)\s*\)/.exec(chain);
  const tier = tierMatch ? (tierMatch[1] !== undefined ? Number(tierMatch[1]) : Number(vars.tier)) : 0;
  const result = parseItem(fill(output));
  const inputItem = parseItem(fill(input));
  recipes[key] = {
    id: key,
    recipeId,
    input: inputItem.tag ? { tag: inputItem.tag } : { item: inputItem.item },
    result: { item: result.item ?? result.tag, ...(result.count ? { count: result.count } : {}) },
    tier,
    rules: rulesText.split(',').map((r) => r.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean),
  };
  sources[key] = `tfg:${path.relative(scripts, file).replace(/\\/g, '/')}`;
  literalCount++;
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith('.js') ? [full] : [];
  });
}
for (const file of walk(scripts)) {
  if (file.endsWith('recipes.material_tfc.js') || file.endsWith('recipes.materials.js') || file.endsWith('recipes.material_tag_prefixes.js')) continue;
  const text = read(file);
  for (const m of text.matchAll(ANVIL_CALL)) {
    const [whole, , output, , input, rulesText, chain, , idText] = m;
    const templated = /\$\{(\w+)\./.exec(whole);
    if (!templated) {
      addLiteral(file, output, input, rulesText, chain, idText);
      continue;
    }
    // A loop over a small literal array: find the array the loop variable walks.
    const loopVar = templated[1];
    const before = text.slice(0, m.index);
    const loop = [...before.matchAll(new RegExp(`(\\w+)\\.forEach\\(\\s*${loopVar}\\s*=>`, 'g'))].at(-1);
    let items = loop ? literalArray(text, loop[1]) : null;
    if (loop && items && /\.concat\(/.test((new RegExp(`const\\s+${loop[1]}\\s*=[\\s\\S]*?\\]\\s*\\.concat\\((\\w+)\\)`).exec(text) ?? [''])[0])) {
      const other = new RegExp(`const\\s+${loop[1]}\\s*=[\\s\\S]*?\\]\\s*\\.concat\\((\\w+)\\)`).exec(text)[1];
      items = items.concat(literalArray(text, other) ?? []);
    }
    if (!items) {
      skipped.push(`${path.relative(scripts, file)}: ${idText}`);
      continue;
    }
    // `if (bar.metal !== 'iron') { ... }` guards: find each such `if` after the loop starts and
    // check, by brace depth, whether the call sits inside its block. A regex over "no closing brace
    // since the if" is wrong here: the block itself contains `event.remove({ ... })` braces.
    const loopStart = loop.index;
    const exclusions = [];
    for (const g of text.slice(loopStart, m.index).matchAll(/if\s*\(\s*\w+\.metal\s*!==\s*'(\w+)'\s*\)\s*\{/g)) {
      let depth = 0;
      let inside = true;
      for (let i = loopStart + g.index + g[0].length - 1; i < m.index; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}' && --depth === 0) {
          inside = false;
          break;
        }
      }
      if (inside) exclusions.push(g[1]);
    }
    for (const vars of items) {
      if (exclusions.includes(vars.metal)) continue;
      addLiteral(file, output, input, rulesText, chain, idText, vars);
    }
  }
}

// --- 4. Anvil recipes from every other mod in the pack ---------------------------------------------
// TFC is not the only mod that adds them, and the pack ships eight more that do: water flasks, boats
// (firmaciv), rails (rnr), scraping, Firmalife, sns, afc and tfchotornot -- 63 recipes between them.
// Pau went looking for the red steel flask and it was not there, because nothing read the jars.
// A recipe's id decides its target work, so the namespace matters: `waterflasks:anvil/...`, not `tfc:`.
let jarCount = 0;
const modsDir = arg('mods', instance === null ? null : path.join(instance, 'mods'));
if (modsDir === null) console.warn('  ! no --instance or --mods: anvil recipes from other mods are skipped');
if (modsDir !== null && fs.existsSync(modsDir)) {
  const jars = fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar')).sort();
  for (const jar of jars) {
    let entries;
    try {
      // `jar tf` would need a JDK; unzip -Z1 is what is on the box, and a bad jar is skipped.
      entries = execSync(`unzip -Z1 "${path.join(modsDir, jar)}" "data/*/recipes/anvil/*.json"`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 1 << 24,
      }).split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean);
    } catch {
      continue; // no anvil recipes in this jar
    }
    for (const entry of entries) {
      const namespace = entry.split('/')[1];
      if (namespace === 'tfc') continue; // already read from the checkout, which is authoritative
      let data;
      try {
        data = JSON.parse(execSync(`unzip -p "${path.join(modsDir, jar)}" "${entry}"`, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 22,
        }));
      } catch {
        skipped.push(`${jar}:${entry}`);
        continue;
      }
      if (data.type !== 'tfc:anvil') continue;
      const name = path.basename(entry, '.json');
      // Namespaced only where it would collide, so existing ids and their saved recipes survive.
      const id = recipes[name] === undefined ? name : `${namespace}_${name}`;
      recipes[id] = {
        id,
        recipeId: `${namespace}:anvil/${name}`,
        input: data.input ?? null,
        result: data.result ?? null,
        tier: data.tier ?? 0,
        rules: data.rules ?? [],
      };
      sources[id] = namespace;
      jarCount++;
    }
  }
} else {
  console.warn(`  ! ${modsDir} not found: anvil recipes from other mods will be missing`);
}


// --- 5. The per-material GregTech part recipes, decided by the instance's own item registry --------
//
// `recipes.material_tag_prefixes.js` generates these for every material, then GregTech skips the
// ones whose part it never made. Which parts exist is a runtime decision, so this used to be left
// out entirely and reported as `_meta.omitted` -- Pau went looking for the brass bolt and found
// nothing. The registry settles it: a saved world's `level.dat` carries Forge's full item registry,
// 31 404 entries, so "does gtceu:brass_bolt exist" stops being a guess.
//
// Two of the script's families are still out: `bars` and `trapdoor` resolve to no registered item
// under any id shape tried, so listing them would be the guessing this section exists to avoid.
// The rules are read from the script itself (`scriptFamilies`), not transcribed here.
const FAMILY_RULES = scriptFamilies(tfgRoot);
const PART_FAMILIES = [
  // [suffix, output id, count, input id]
  ['sheet', 'gtceu:{m}_plate', 1, 'gtceu:{m}_double_ingot'],
  ['rod', 'gtceu:{m}_rod', 2, 'gtceu:{m}_ingot'],
  ['bolt', 'gtceu:{m}_bolt', 4, 'gtceu:{m}_rod'],
  ['screw', 'gtceu:{m}_screw', 4, 'gtceu:{m}_rod'],
  ['ring', 'gtceu:{m}_ring', 2, 'gtceu:{m}_rod'],
  ['buzzsaw_blade', 'gtceu:{m}_buzz_saw_blade', 1, 'gtceu:double_{m}_plate'],
  ['spring', 'gtceu:{m}_spring', 1, 'gtceu:long_{m}_rod'],
  ['small_spring', 'gtceu:small_{m}_spring', 1, 'gtceu:{m}_rod'],
  ['nugget', 'gtceu:{m}_nugget', 9, 'gtceu:{m}_ingot'],
  ['small_gear', 'gtceu:small_{m}_gear', 1, 'gtceu:{m}_ingot'],
].map(([suffix, outPattern, count, inPattern]) => {
  const rules = FAMILY_RULES.get(suffix)?.rules;
  if (rules === undefined) throw new Error(`recipes.material_tag_prefixes.js has no '${suffix}' family`);
  return [suffix, outPattern, count, inPattern, rules];
});

/*
 * The material's *real* ingot, which is not always GregTech's. The script's
 * `ingotItem` is `ChemicalHelper.get(TagPrefix.ingot, material)`, and for copper that is
 * `minecraft:copper_ingot`, for red steel `tfc:metal/ingot/red_steel`. Requiring
 * `gtceu:<m>_ingot` skipped the part recipe for seven rods, so they kept TFC's three rules where the
 * game has TFG's `draw_last`. The first id the registry actually has wins.
 */
function realInput(pattern, material, registered) {
  const candidates = [pattern.replace('{m}', material)];
  if (pattern === 'gtceu:{m}_ingot') candidates.push(`minecraft:${material}_ingot`, `tfc:metal/ingot/${material}`);
  if (pattern === 'gtceu:{m}_double_ingot') candidates.push(`tfc:metal/double_ingot/${material}`);
  return candidates.find((id) => registered.has(id)) ?? null;
}

/** Forge's item registry out of a save's level.dat -- the only place that says what really exists. */
function registeredItems(worldDir) {
  const buf = zlib.gunzipSync(fs.readFileSync(path.join(worldDir, 'level.dat')));
  let p = 0;
  const u1 = () => buf.readUInt8(p++);
  const i4 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const str = () => { const n = buf.readUInt16BE(p); p += 2; const v = buf.toString('utf8', p, p + n); p += n; return v; };
  const payload = (kind) => {
    switch (kind) {
      case 1: return buf.readInt8(p++);
      case 2: { const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: return i4();
      case 4: { const v = buf.readBigInt64BE(p); p += 8; return v; }
      case 5: { const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { const v = buf.readDoubleBE(p); p += 8; return v; }
      // `p += i4()` would read p before i4() advanced it, losing four bytes and the registry.
      case 7: { const n = i4(); p += n; return null; }
      case 8: return str();
      case 9: { const k = u1(); const n = i4(); const a = []; for (let i = 0; i < n; i++) a.push(payload(k)); return a; }
      case 10: { const o = {}; for (;;) { const k = u1(); if (k === 0) return o; const name = str(); o[name] = payload(k); } }
      case 11: { const n = i4(); p += 4 * n; return null; }
      case 12: { const n = i4(); p += 8 * n; return null; }
      default: throw new Error(`bad NBT tag ${kind}`);
    }
  };
  const kind = u1();
  str();
  const root = payload(kind);
  return new Set((root?.fml?.Registries?.['minecraft:item']?.ids ?? []).map((entry) => entry.K));
}

let partCount = 0;
let overrodeCount = 0;
// "New World" is Minecraft's default save name; `--world` picks another save.
const worldDir = arg('world', instance === null ? null : path.join(instance, 'saves', 'New World'));
let items = null;
try {
  if (worldDir === null) throw new Error('no --instance or --world given');
  items = registeredItems(worldDir);
} catch (error) {
  console.warn(`  ! no item registry at ${worldDir} (${error.message}): per-material part recipes will be missing`);
}
if (items !== null) {
  for (const [suffix, outPattern, count, inPattern, rules] of PART_FAMILIES) {
    for (const material of Object.keys(tiers)) {
      const out = outPattern.replace('{m}', material);
      const input = realInput(inPattern, material, items);
      if (!items.has(out) || input === null) continue;
      const id = `${material}_${suffix}`;
      // Same id as TFC's own recipe means the script *replaces* it, which is the whole reason 18
      // rod recipes were showing TFC's rules instead of the one-step `draw_last` TFG gives them.
      if (recipes[id] !== undefined) overrodeCount++;
      recipes[id] = {
        id,
        recipeId: `tfc:anvil/${id}`,
        input: { item: input },
        result: count === 1 ? { item: out } : { item: out, count },
        tier: tiers[material] ?? 0,
        rules,
      };
      sources[id] = 'tfg-part';
      partCount++;
    }
  }
}

const omitted = [...read(path.join(scripts, 'tfg/ores_and_materials/recipes.material_tag_prefixes.js')).matchAll(/addAnvilRecipe\([^;]*?'(\w+)'\);/g)].map((m) => m[1]);
const out = {
  _meta: {
    source: 'tools/extract-tfg-anvil-recipes.mjs: TFC recipe JSON, then TerraFirmaGreg KubeJS additions and overrides.',
    tfcCommit: gitHead(tfcRoot),
    tfgCommit: gitHead(tfgRoot),
    counts: { tfc: tfcCount, tfgTool: toolCount, tfgArmor: armorCount, tfgLiteral: literalCount, otherMods: jarCount, tfgParts: partCount, tfgPartsOverriding: overrodeCount, total: Object.keys(recipes).length },
    omitted: {
      reason:
        "Per-material part families with no registered item under any id shape tried. Everything " +
        "else in recipes.material_tag_prefixes.js is now resolved against the instance's own item " +
        'registry -- see section 5.',
      parts: ['bars', 'trapdoor'],
      scriptFamilies: [...new Set(omitted)],
    },
    skipped,
  },
  recipes: Object.fromEntries(Object.entries(recipes).sort(([a], [b]) => a.localeCompare(b))),
};
// Read from files only, never checked against the game's own recipe list. The last comparison
// with a dump found 27 recipes here that the game does not have (`firmaciv:anvil/cleat`, all nine
// `tfcscraping:anvil/*`…) and 20 it does have missing.
console.warn('  ! read from scripts and JSON only: the catalogue may list recipes the game does not have');
fs.writeFileSync(path.join(root, 'src/data/tfg/anvil-recipes.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out._meta.counts), 'skipped:', skipped.length, skipped.slice(0, 5));

function gitHead(dir) {
  try {
    return execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
