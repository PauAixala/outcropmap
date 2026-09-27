#!/usr/bin/env node
/**
 * Extract world-gen and recipe DATA from an installed mod/modpack instance into src/data/<profile>/.
 *
 * Usage:
 *   node tools/extract-datapack.mjs --profile tfc-1.20 --source "$HOME/reference/tfc"
 *   node tools/extract-datapack.mjs --profile tfg --source "$HOME/reference/tfg"
 *
 * TerraFirmaGreg keeps a vein folder per dimension. `--dimension <name>` picks one other than
 * `earth` and writes `veins-<name>.json` instead of `veins.json`; it implies veins only, since
 * nothing else in here is per-dimension:
 *
 *   node tools/extract-datapack.mjs --profile tfg --source "$HOME/reference/tfg" --dimension nether
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { portableSource } from './lib/portable-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Parse CLI arguments
const args = process.argv.slice(2);
let profile = null;
let sourceDir = null;
// TFG's vein tag borrows from TFC's data, so extracting it needs the TFC checkout too.
let tfcSourceDir = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'reference', 'tfc');
let dimension = 'earth';
/** Where to write; defaults to src/data/<profile>. Point it elsewhere to compare before replacing. */
let outArg = null;
/** Vein names read from the TerraFirmaCraft checkout rather than the modpack, for `_meta`. */
const borrowedFromTfc = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--profile' && i + 1 < args.length) {
    profile = args[++i];
  } else if (args[i] === '--source' && i + 1 < args.length) {
    sourceDir = args[++i];
  } else if (args[i] === '--tfc-source' && i + 1 < args.length) {
    tfcSourceDir = args[++i];
  } else if (args[i] === '--dimension' && i + 1 < args.length) {
    dimension = args[++i];
  } else if (args[i] === '--out' && i + 1 < args.length) {
    outArg = args[++i];
  }
}

if (!profile || !sourceDir) {
  console.error('Usage: node extract-datapack.mjs --profile <profile> --source <source-dir>');
  console.error('  --profile: tfc-1.20, tfg, etc.');
  console.error('  --source: path to TFC or TFG source tree');
  process.exit(1);
}

const outputDir = outArg ?? path.join(PROJECT_ROOT, 'src', 'data', profile);

// Helper: get git commit hash
function getGitCommit(dir) {
  try {
    return execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

// Helper: read JSON file
async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

// Helper: list JSON files in directory
async function listJsonFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    return files.filter(f => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

// Helper: ensure directory exists
async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

// Helper: write JSON with sorted keys
async function writeJson(filePath, data) {
  const sorted = sortKeysDeep(data);
  const json = JSON.stringify(sorted, null, 2) + '\n';
  await fs.writeFile(filePath, json, 'utf-8');
}

// Recursively sort object keys for deterministic output
function sortKeysDeep(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortKeysDeep);
  } else if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj)
      .sort()
      .forEach(key => {
        sorted[key] = sortKeysDeep(obj[key]);
      });
    return sorted;
  }
  return obj;
}

// Extract ore veins
async function extractVeins() {
  const veins = {};
  const counts = { extracted: 0, merged: 0 };

  // For TFG, look in kubejs/data/tfg; for TFC, in src/main/resources/data/tfc
  let configuredDir, placedDir;

  if (profile === 'tfg') {
    configuredDir = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'worldgen', 'configured_feature', dimension, 'vein');
    placedDir = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'worldgen', 'placed_feature', dimension, 'vein');
  } else if (profile === 'tfc-1.20') {
    configuredDir = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'configured_feature', 'vein');
    placedDir = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'placed_feature', 'vein');
  } else {
    console.error(`Unknown profile: ${profile}`);
    process.exit(1);
  }

  // Only the configured features are read. The placed ones are checked because a configured vein
  // with no placement never generates -- but the folder they sit in is not fixed (Venus's two live
  // under `vein_manual/` and are referenced straight from its biome files), so a missing folder is
  // a warning to go and look, not a reason to extract nothing.
  try {
    await fs.stat(configuredDir);
  } catch {
    console.error(`Missing vein directory for profile ${profile}: ${configuredDir}`);
    process.exit(1);
  }
  try {
    await fs.stat(placedDir);
  } catch {
    console.warn(`  ! no ${placedDir}: check these veins are placed somewhere before trusting them`);
  }

  // Read all configured features
  const sources = [];
  for (const file of await listJsonFiles(configuredDir)) {
    sources.push([file.replace('.json', ''), path.join(configuredDir, file)]);
  }

  // TerraFirmaGreg builds its overworld vein set by *adding to TFC's own tag*, so several veins it
  // generates live in TFC's data and not in the modpack's own folder. Missing them is not a cosmetic
  // gap: the three dikes below place raw granite, diorite and gabbro in columns of any other rock,
  // which is exactly the host rock several veins need. Measured against Pau's world, our rock model
  // was 98.3% right on every other rock and 79.2% on those three -- see docs/WORLDGEN-NOTES.md.
  if (profile === 'tfg' && dimension === 'earth') {
    const tagsFile = path.join(sourceDir, 'kubejs', 'server_scripts', 'tfg', 'overworld', 'tags.overworld.js');
    let script = '';
    try {
      script = await fs.readFile(tagsFile, 'utf-8');
    } catch {
      console.warn(`  ! ${tagsFile} not found: veins TFG borrows from TFC will be missing`);
    }
    const borrowed = [...script.matchAll(/in_biome\/veins['"],\s*['"]tfc:vein\/([a-z0-9_]+)['"]/g)].map((m) => m[1]);
    const tfcVeinDir = path.join(tfcSourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'configured_feature', 'vein');
    for (const name of borrowed) {
      const file = path.join(tfcVeinDir, `${name}.json`);
      if (await readJson(file)) {
        sources.push([name, file]);
        borrowedFromTfc.push(name);
      } else console.warn(`  ! TFG's tag adds tfc:vein/${name}, but ${file} is not there`);
    }
    if (borrowed.length > 0) console.log(`  + ${borrowed.length} veins TFG adds from TFC's own data`);
  }

  for (const [name, filePath] of sources) {
    const data = await readJson(filePath);
    if (!data) continue;

    const config = data.config || {};
    const type = data.type || '';

    // Determine vein type (cluster, pipe, disc, etc.)
    let veinType = 'cluster'; // default
    if (type.includes('disc')) veinType = 'disc';
    else if (type.includes('pipe')) veinType = 'pipe';
    else if (type.includes('cluster')) veinType = 'cluster';

    // Handle kaolin specially
    if (name.includes('kaolin')) veinType = 'kaolin_disc';

    // Build block replacement mapping
    const blocks = {};
    if (config.blocks && Array.isArray(config.blocks)) {
      for (const blockEntry of config.blocks) {
        if (blockEntry.replace && blockEntry.with) {
          const hostRocks = blockEntry.replace;
          const replacements = blockEntry.with;
          for (const hostRock of hostRocks) {
            blocks[hostRock] = replacements;
          }
        }
      }
    }

    // Build the vein record
    const vein = {
      id: name,
      type: veinType,
      rarity: config.rarity !== undefined ? config.rarity : null,
      size: config.size !== undefined ? config.size : null,
      density: config.density !== undefined ? config.density : null,
      min_y: config.min_y !== undefined ? config.min_y : null,
      max_y: config.max_y !== undefined ? config.max_y : null,
      random_name: config.random_name || null,
      blocks: blocks,
    };

    // Disc-shaped veins (`tfc:disc_vein`, `tfc:kaolin_disc_vein`) carry a vertical thickness
    // ("height") alongside the horizontal "size" -- net.dries007.tfc.world.feature.vein.
    // DiscVeinConfig#height. Not present on cluster/pipe veins, so only written when the source
    // JSON actually has it (never defaulted to a made-up number for a shape that has no such field).
    if (config.height !== undefined) {
      vein.height = config.height;
    }

    // Pipe veins (`tfc:pipe_vein`) are a tilted, tapering cylinder rather than a blob, and carry
    // their own shape fields -- net.dries007.tfc.world.feature.vein.PipeVeinConfig. Without these
    // a pipe vein cannot be placed at all, which is why they were silently missing until 2026-09-10.
    // Written only when present, never defaulted: `radius` has no sensible fallback and `sign`
    // changes which way the pipe leans.
    for (const field of ['radius', 'min_skew', 'max_skew', 'min_slant', 'max_slant', 'sign']) {
      if (config[field] !== undefined) {
        vein[field] = config[field];
      }
    }

    // Whether this vein's Y range is an absolute world height or an offset from the real surface
    // height at generation time (net.dries007.tfc.world.feature.vein.VeinConfig#projectToSurface /
    // #projectOffset -- see VeinFeature#place's `projectedY`). Most veins omit both and default to
    // `false` (VeinConfig.CODEC's `optionalFieldOf(..., false)`), so this only records them when the
    // source JSON is explicit -- a consumer must still treat an absent `project` as `false`, not as
    // "unknown". A profile that has not ported real surface height cannot honestly place a
    // `project: true` vein's ore at a real Y and must say so rather than guess -- see
    // docs/WORLDGEN-NOTES.md's "Ore veins" section.
    if (config.project !== undefined) {
      vein.project = config.project;
    }
    if (config.project_offset !== undefined) {
      vein.project_offset = config.project_offset;
    }

    // Whether ore blocks within this vein only ever generate in columns detected as "near lava"
    // at world-gen time (net.dries007.tfc.world.feature.vein.VeinConfig#nearLava --
    // VeinFeature#place's per-column `isNearLava` gate). This is a real existence-level gate: a
    // vein whose bounding box never touches lava places ZERO ore blocks, not just a partial
    // pattern -- see disc-vein.ts's header, "Veins this port cannot verify: near_lava". Recorded
    // whenever the source JSON is explicit (`Codecs.optionalFieldOf(Codec.BOOL, "near_lava",
    // false)` defaults to `false`, so this only writes the field when it is truly `true`).
    if (config.near_lava === true) {
      vein.near_lava = true;
    }

    // Optional fields: biomes and indicator
    if (config.biomes) {
      vein.biomes = config.biomes;
    }
    if (config.indicator) {
      vein.indicator = config.indicator;
    }

    veins[name] = vein;
    counts.extracted++;
  }

  return { veins, counts };
}

// Extract anvil recipes
async function extractAnvilRecipes() {
  const recipes = {};
  const counts = { extracted: 0 };

  let recipesDir;
  if (profile === 'tfg') {
    // TFG may override, but for now check if they have anvil recipes
    recipesDir = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'recipes', 'anvil');
  } else if (profile === 'tfc-1.20') {
    recipesDir = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'recipes', 'anvil');
  } else {
    return { recipes: {}, counts };
  }

  try {
    await fs.stat(recipesDir);
  } catch (e) {
    // Recipes directory doesn't exist; try the TFC default for TFG
    if (profile === 'tfg') {
      recipesDir = path.join(sourceDir, '..', 'tfc', 'src', 'main', 'resources', 'data', 'tfc', 'recipes', 'anvil');
      try {
        await fs.stat(recipesDir);
      } catch {
        return { recipes: {}, counts };
      }
    } else {
      return { recipes: {}, counts };
    }
  }

  const files = await listJsonFiles(recipesDir);
  for (const file of files) {
    const name = file.replace('.json', '');
    const data = await readJson(path.join(recipesDir, file));
    if (!data) continue;

    const recipe = {
      id: name,
      // The full resource id, which `AnvilRecipe.computeTarget` hashes for the per-world target.
      recipeId: `${profile === 'tfg' ? 'tfg' : 'tfc'}:anvil/${name}`,
      input: data.input || null,
      result: data.result || null,
      tier: data.tier !== undefined ? data.tier : null,
      rules: data.rules || [],
    };

    recipes[name] = recipe;
    counts.extracted++;
  }

  return { recipes, counts };
}

// Extract anvil action deltas
function extractAnvilDeltas() {
  // These are hardcoded from the ForgeStep enum in the Java source
  // File: net/dries007/tfc/common/capabilities/forge/ForgeStep.java
  const deltas = {
    'hit_light': -3,
    'hit_medium': -6,
    'hit_hard': -9,
    'draw': -15,
    'punch': 2,
    'bend': 7,
    'upset': 13,
    'shrink': 16,
  };

  return { deltas, counts: { confirmed: true } };
}

// Extract rocks from world preset
async function extractRocks() {
  const rocks = {};
  const counts = { extracted: 0 };
  const emptyRockLayers = { bottom: [], layers: [], oceanFloor: [], land: [], volcanic: [], uplift: [] };

  let presetPath;
  if (profile === 'tfg') {
    presetPath = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'worldgen', 'world_preset', 'overworld.json');
  } else if (profile === 'tfc-1.20') {
    presetPath = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'world_preset', 'overworld.json');
  } else {
    return { rocks: {}, rockLayers: emptyRockLayers, counts };
  }

  try {
    await fs.stat(presetPath);
  } catch {
    // Try the TFC preset for TFG
    if (profile === 'tfg') {
      presetPath = path.join(sourceDir, '..', 'tfc', 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'world_preset', 'overworld.json');
      try {
        await fs.stat(presetPath);
      } catch {
        return { rocks: {}, rockLayers: emptyRockLayers, counts };
      }
    } else {
      return { rocks: {}, rockLayers: emptyRockLayers, counts };
    }
  }

  const data = await readJson(presetPath);
  if (!data) return { rocks: {}, rockLayers: emptyRockLayers, counts };

  // Extract rock layer settings from the preset
  const dims = data.dimensions || {};
  const overworldGen = dims['minecraft:overworld']?.generator || {};
  const tfcSettings = overworldGen.tfc_settings || {};
  const rockLayerSettings = tfcSettings.rock_layer_settings || {};

  // Collect all rock definitions
  if (rockLayerSettings.rocks) {
    Object.entries(rockLayerSettings.rocks).forEach(([id, blockId]) => {
      rocks[id] = {
        id,
        block: blockId,
      };
      counts.extracted++;
    });
  }

  // Collect the rock layer *tree* topology (net.dries007.tfc.world.settings.RockLayerSettings):
  // which rock a `ChooseRocks`-assigned "type" (ocean/land/volcanic/uplift) picks at layer 0, and
  // which named sub-layer each subsequent depth samples from. This is a recursive structure, not a
  // flat list, so `bottom`/`land`/`volcanic`/`uplift`/`oceanFloor` name the *root* layer(s) for each
  // type, and `layers` holds every other named layer's own rock choices.
  //
  // Each layer's rock choices are written as an ordered array of [rockId, parentLayerId] pairs, not
  // a `{rockId: parentLayerId}` object: `writeJson`'s `sortKeysDeep` alphabetically re-sorts every
  // plain object's keys, and this order is not cosmetic — `RockLayerSettings.sampleAtLayer` indexes
  // into it with `RandomSource.nextInt(list.size())`, so re-sorting it would silently change which
  // rock a given seed picks. Arrays are left untouched by `sortKeysDeep` (it only maps over them),
  // which is exactly why every ordered list here — including this one — is an array.
  const rockLayers = {
    bottom: Array.isArray(rockLayerSettings.bottom) ? rockLayerSettings.bottom.slice() : [],
    layers: Array.isArray(rockLayerSettings.layers)
      ? rockLayerSettings.layers.map((layer) => ({
          id: layer.id,
          entries: Object.entries(layer.layers || {}),
        }))
      : [],
    oceanFloor: Array.isArray(rockLayerSettings.ocean_floor) ? rockLayerSettings.ocean_floor.slice() : [],
    land: Array.isArray(rockLayerSettings.land) ? rockLayerSettings.land.slice() : [],
    volcanic: Array.isArray(rockLayerSettings.volcanic) ? rockLayerSettings.volcanic.slice() : [],
    uplift: Array.isArray(rockLayerSettings.uplift) ? rockLayerSettings.uplift.slice() : [],
  };

  return { rocks, rockLayers, counts };
}

// Extract biomes
async function extractBiomes() {
  const biomes = {};
  const counts = { extracted: 0 };

  let biomesDir;
  if (profile === 'tfg') {
    biomesDir = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'worldgen', 'biome');
  } else if (profile === 'tfc-1.20') {
    biomesDir = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'biome');
  } else {
    return { biomes: {}, counts };
  }

  try {
    await fs.stat(biomesDir);
  } catch {
    // Try the TFC biomes for TFG
    if (profile === 'tfg') {
      biomesDir = path.join(sourceDir, '..', 'tfc', 'src', 'main', 'resources', 'data', 'tfc', 'worldgen', 'biome');
      try {
        await fs.stat(biomesDir);
      } catch {
        return { biomes: {}, counts };
      }
    } else {
      return { biomes: {}, counts };
    }
  }

  const files = await listJsonFiles(biomesDir);
  for (const file of files) {
    const name = file.replace('.json', '');
    biomes['tfc:' + name] = {
      id: 'tfc:' + name,
    };
    counts.extracted++;
  }

  return { biomes, counts };
}

// Extract biome tags (data/<ns>/tags/worldgen/biome/*.json) referenced by vein `biomes`
// restrictions (net.dries007.tfc.world.feature.vein.VeinConfig#biomes, a `TagKey<Biome>`), fully
// resolved to their flat member-biome-id lists so a vein's biome restriction can be checked with a
// plain Set membership test at runtime -- no tag-resolution logic needed outside this tool.
// A tag's own `values` array can itself reference another tag with a leading "#" (Minecraft's tag
// file format), so this resolves recursively, matching how the game itself flattens tags; TFC's own
// worldgen biome tags happen not to nest today (checked against $HOME/reference/tfc), but resolving
// recursively costs nothing and stays correct if that ever changes upstream.
/**
 * Crop and plant climate ranges (`data/tfc/tfc/climate_ranges/{crop,plant}/*.json`) —
 * net.dries007.tfc.util.climate.ClimateRange. Each file is min/max hydration and temperature plus a
 * "wiggle" band the game allows for survival but not growth.
 *
 * These drive the "what grows here" readout: crossed with a position's climate they answer the
 * question a player actually has when picking a base. Extracted, never hand-typed (AGENTS.md section 4).
 */
async function extractClimateRanges() {
  const base = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'tfc', 'climate_ranges');
  const ranges = {};
  let extracted = 0;
  for (const kind of ['crop', 'plant']) {
    const dir = path.join(base, kind);
    let files;
    try {
      files = await listJsonFiles(dir);
    } catch {
      continue; // A profile without this data simply has no ranges.
    }
    for (const file of files) {
      const data = await readJson(path.join(dir, file));
      const id = file.replace(/\.json$/, '');
      // `min_*`/`max_*` are required by ClimateRange's reader; the wiggle fields default to 0.
      if (
        data.min_hydration === undefined ||
        data.max_hydration === undefined ||
        data.min_temperature === undefined ||
        data.max_temperature === undefined
      ) {
        continue;
      }
      ranges[`${kind}/${id}`] = {
        kind,
        id,
        min_hydration: data.min_hydration,
        max_hydration: data.max_hydration,
        hydration_wiggle_range: data.hydration_wiggle_range ?? 0,
        min_temperature: data.min_temperature,
        max_temperature: data.max_temperature,
        temperature_wiggle_range: data.temperature_wiggle_range ?? 0,
      };
      extracted++;
    }
  }
  return { ranges, counts: { extracted } };
}

async function extractBiomeTags() {
  const tags = {};
  const counts = { extracted: 0 };

  let tagsDir;
  if (profile === 'tfg') {
    tagsDir = path.join(sourceDir, 'kubejs', 'data', 'tfg', 'tags', 'worldgen', 'biome');
  } else if (profile === 'tfc-1.20') {
    tagsDir = path.join(sourceDir, 'src', 'main', 'resources', 'data', 'tfc', 'tags', 'worldgen', 'biome');
  } else {
    return { tags: {}, counts };
  }

  try {
    await fs.stat(tagsDir);
  } catch {
    // Try the TFC tags for TFG, same fallback pattern as extractBiomes/extractRocks.
    if (profile === 'tfg') {
      tagsDir = path.join(sourceDir, '..', 'tfc', 'src', 'main', 'resources', 'data', 'tfc', 'tags', 'worldgen', 'biome');
      try {
        await fs.stat(tagsDir);
      } catch {
        return { tags: {}, counts };
      }
    } else {
      return { tags: {}, counts };
    }
  }

  const namespace = profile === 'tfg' ? 'tfg' : 'tfc';
  const files = await listJsonFiles(tagsDir);
  const rawTagNames = files.map((f) => f.replace('.json', ''));

  // Resolve one tag name to its flat set of member biome ids, recursing into any value that is
  // itself a tag reference ("#namespace:name"). `seen` guards against a cycle in the source data
  // (which would otherwise recurse forever) -- if TFC's own datapack ever had one, that would be a
  // bug in TFC, not something to silently paper over, so a cyclic tag simply stops expanding rather
  // than throwing and aborting the whole extraction.
  async function resolveTag(tagName, seen) {
    if (seen.has(tagName)) return new Set();
    seen.add(tagName);
    const data = await readJson(path.join(tagsDir, `${tagName}.json`));
    if (!data || !Array.isArray(data.values)) return new Set();
    const members = new Set();
    for (const value of data.values) {
      if (typeof value !== 'string') continue;
      if (value.startsWith('#')) {
        const nested = value.slice(1);
        // Only follow nested tags that live in this same tag directory (same namespace); a
        // cross-namespace or non-worldgen-biome tag reference is left as-is rather than guessed at.
        const nestedName = nested.startsWith(`${namespace}:`) ? nested.slice(namespace.length + 1) : nested;
        for (const member of await resolveTag(nestedName, seen)) members.add(member);
      } else {
        members.add(value.includes(':') ? value : `${namespace}:${value}`);
      }
    }
    return members;
  }

  for (const tagName of rawTagNames) {
    const members = await resolveTag(tagName, new Set());
    tags[`${namespace}:${tagName}`] = [...members].sort();
    counts.extracted++;
  }

  return { tags, counts };
}

// Main function
async function main() {
  console.log(`Extracting data for profile: ${profile}`);
  console.log(`Source: ${sourceDir}`);
  console.log(`Output: ${outputDir}`);
  console.log('');

  // Ensure output directory exists
  await ensureDir(outputDir);

  // Get metadata
  const gitCommit = getGitCommit(sourceDir);
  const now = new Date().toISOString();
  const meta = {
    '_meta': {
      // The upstream URL or `$HOME/reference/<x>`, never this machine's absolute path.
      source_repo: portableSource(sourceDir),
      git_commit: gitCommit,
      extraction_date: now,
      tool_version: '1.0.0',
    },
  };

  // Extract all data
  console.log('Extracting ore veins...');
  const veinsData = await extractVeins();
  // Veins TerraFirmaGreg adds from TerraFirmaCraft's own data come from a second repository, and
  // the file says so (NOTICE.md section 1).
  const veinsMeta =
    borrowedFromTfc.length === 0
      ? meta
      : {
          _meta: {
            ...meta._meta,
            also_read: {
              source_repo: portableSource(tfcSourceDir),
              git_commit: getGitCommit(tfcSourceDir),
              veins: borrowedFromTfc.map((name) => `tfc:vein/${name}`),
            },
          },
        };
  const veinsOutput = { ...veinsMeta, veins: veinsData.veins };
  const veinsFile = dimension === 'earth' ? 'veins.json' : `veins-${dimension}.json`;
  await writeJson(path.join(outputDir, veinsFile), veinsOutput);
  console.log(`  Extracted ${veinsData.counts.extracted} veins into ${veinsFile}`);

  // Nothing else in this tool is per-dimension, and rewriting the overworld's rocks and biomes from
  // a run aimed at the Moon would quietly replace correct data with the same correct data at best.
  if (dimension !== 'earth') {
    console.log('Done (veins only: --dimension is per-dimension and nothing else here is).');
    return;
  }

  console.log('Extracting anvil recipes...');
  const recipesData = await extractAnvilRecipes();
  if (Object.keys(recipesData.recipes).length > 0) {
    const recipesOutput = { ...meta, recipes: recipesData.recipes };
    await writeJson(path.join(outputDir, 'anvil-recipes.json'), recipesOutput);
    console.log(`  Extracted ${recipesData.counts.extracted} recipes`);
  } else {
    console.log('  No recipes found (using TFC defaults)');
  }

  console.log('Extracting anvil action deltas...');
  const deltasData = extractAnvilDeltas();
  const deltasOutput = { ...meta, actions: deltasData.deltas };
  await writeJson(path.join(outputDir, 'anvil.json'), deltasOutput);
  console.log(`  Confirmed ${Object.keys(deltasData.deltas).length} actions from ForgeStep enum`);

  console.log('Extracting rocks...');
  const rocksData = await extractRocks();
  if (Object.keys(rocksData.rocks).length > 0) {
    const rocksOutput = { ...meta, rocks: rocksData.rocks, rockLayers: rocksData.rockLayers };
    await writeJson(path.join(outputDir, 'rocks.json'), rocksOutput);
    console.log(`  Extracted ${rocksData.counts.extracted} rock types`);
  } else {
    console.log('  No rocks found');
  }

  console.log('Extracting biomes...');
  const biomesData = await extractBiomes();
  if (Object.keys(biomesData.biomes).length > 0) {
    const biomesOutput = { ...meta, biomes: biomesData.biomes };
    await writeJson(path.join(outputDir, 'biomes.json'), biomesOutput);
    console.log(`  Extracted ${biomesData.counts.extracted} biomes`);
  } else {
    console.log('  No biomes found');
  }

  console.log('Extracting biome tags...');
  const biomeTagsData = await extractBiomeTags();
  if (Object.keys(biomeTagsData.tags).length > 0) {
    const biomeTagsOutput = { ...meta, tags: biomeTagsData.tags };
    await writeJson(path.join(outputDir, 'biome-tags.json'), biomeTagsOutput);
    console.log(`  Extracted ${biomeTagsData.counts.extracted} biome tags`);
  } else {
    console.log('  No biome tags found');
  }

  console.log('Extracting climate ranges...');
  const climateRangesData = await extractClimateRanges();
  if (Object.keys(climateRangesData.ranges).length > 0) {
    const climateRangesOutput = { ...meta, ranges: climateRangesData.ranges };
    await writeJson(path.join(outputDir, 'climate-ranges.json'), climateRangesOutput);
    console.log(`  Extracted ${climateRangesData.counts.extracted} climate ranges`);
  } else {
    console.log('  No climate ranges found');
  }

  console.log('');
  console.log('Extraction complete!');
}

main().catch(err => {
  console.error('Error during extraction:', err);
  process.exit(1);
});
