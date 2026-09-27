#!/usr/bin/env node
/**
 * Extracts TerraFirmaGreg's overworld structure placement data into src/data/tfg/structures.json.
 *
 * Usage:
 *   node tools/extract-tfg-structures.mjs --instance "<instance>"
 *        --jar "<launcher>/versions/1.20.1/1.20.1.jar" [--reference "$HOME/reference/tfg"]
 *
 *   OUTCROP_INSTANCE and OUTCROP_MC_JAR stand in for --instance and --jar.
 *
 * Sources, in the order the game layers them:
 *   - structure sets: the modpack's KubeJS data (which overrides the ruin mods' own sets);
 *   - structure definitions: KubeJS data for `tfg:*`, the ruin mod jars for the rest;
 *   - biome tags: jar tag files, plus every `event.add(tag, value)` in the KubeJS server scripts
 *     (KubeJS adds to tags; nothing here removes from them), with `#tag` references resolved;
 *   - lithostitched spawn conditions: KubeJS `lithostitched/worldgen_modifier`.
 * Only biome ids TFG's overworld actually generates are kept: a `tfc:*` id in a jar tag names a
 * biome the TFG generator never places, so it can never match.
 *
 * Extracted values only — no Java, no assets. See AGENTS.md section 8.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveInstance, resolveVanillaJar } from './lib/portable-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []),
);
args.instance = resolveInstance(args.instance, { tool: 'extract-tfg-structures' });
const vanillaJar = resolveVanillaJar(args.jar, { tool: 'extract-tfg-structures' });
const reference = args.reference ?? path.join(os.homedir(), 'reference/tfg');
const kubeData = path.join(reference, 'kubejs/data');
const kubeScripts = path.join(reference, 'kubejs/server_scripts');
const mods = path.join(args.instance, 'mods');

const jarNamed = (prefix) => {
  const file = fs.readdirSync(mods).find((name) => name.startsWith(prefix) && name.endsWith('.jar'));
  if (!file) throw new Error(`no ${prefix}*.jar in ${mods}`);
  return path.join(mods, file);
};
const JARS = [
  // Vanilla's own sets are needed for one thing only: an exclusion zone can name a set we do not
  // draw, and the zone is decided by that set's *placement*, so its placement has to be readable.
  vanillaJar,
  jarNamed('tfc_ruins-'),
  jarNamed('tfcstructuremodc-'),
  jarNamed('TerraFirmaCraft-Forge-'),
  jarNamed('TerraFirmaGreg-Core-Modern-'),
];

/** A data file from KubeJS first, then from any jar. `null` when neither has it. */
function readData(relative) {
  const kube = path.join(kubeData, relative);
  if (fs.existsSync(kube)) return fs.readFileSync(kube, 'utf8');
  for (const jar of JARS) {
    try {
      return execFileSync('unzip', ['-p', jar, `data/${relative}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || null;
    } catch {
      /* not in this jar */
    }
  }
  return null;
}

const idPath = (id, folder) => {
  const [ns, rest] = id.split(':');
  return `${ns}/${folder}/${rest}.json`;
};

// Minecraft reads `salt` with Codec.INT: a JSON number past int range keeps its low 32 bits.
const toInt32 = (raw) => Number(BigInt.asIntN(32, BigInt(raw)));

// --- biome tags -----------------------------------------------------------------------------------
/**
 * Biome tags the pack builds from a KubeJS script rather than from a JSON file.
 *
 * Two forms, and the second is the one that matters here. A literal
 * `event.add('tag', 'biome')` is a pair. But every dimension's structure tags are written as a loop:
 *
 *     global.MOON_BIOMES.forEach(biome => { event.add('tfg:has_structure/moonbase', biome) })
 *
 * so a regex over literals finds nothing and the tag silently comes out empty — which on the map
 * reads as "this structure generates in every biome", the exact opposite of the truth. The list the
 * loop walks is a dimension's whole biome list, and we already have that: it is what
 * `tools/extract-dimension-climate.mjs` wrote.
 */
const DIMENSION_BIOME_LISTS = { MOON: 'moon', MARS: 'mars', VENUS: 'venus', GLACIO: 'glacio' };

function dimensionBiomes(name) {
  const file = DIMENSION_BIOME_LISTS[name];
  if (file === undefined) return null;
  const dim = JSON.parse(
    fs.readFileSync(path.join(root, 'src/data/tfg/dimensions', `${file}.json`), 'utf8'),
  );
  return [...new Set(dim.biomes.map((entry) => entry.biome))];
}

const kubeAdds = new Map();
const addTag = (tag, values) => {
  const list = kubeAdds.get(tag) ?? [];
  list.push(...values);
  kubeAdds.set(tag, list);
};

for (const file of walk(kubeScripts).filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/event\.add\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g)) {
    addTag(match[1], [match[2]]);
  }
  // `global.<NAME>_BIOMES.forEach(<var> => { ... event.add('<tag>', <var>) ... })`
  const loops = /global\.([A-Z_]+)_BIOMES\.forEach\(\s*\(?(\w+)\)?\s*=>\s*\{([\s\S]*?)\n\s*\}\)/g;
  for (const loop of text.matchAll(loops)) {
    const biomes = dimensionBiomes(loop[1]);
    if (biomes === null) continue;
    const adds = new RegExp(String.raw`event\.add\(\s*['"]([^'"]+)['"]\s*,\s*${loop[2]}\s*\)`, 'g');
    for (const add of loop[3].matchAll(adds)) addTag(add[1], biomes);
  }
}

const tagCache = new Map();
function resolveTag(tag, seen = new Set()) {
  if (tagCache.has(tag)) return tagCache.get(tag);
  if (seen.has(tag)) return new Set();
  seen.add(tag);
  const out = new Set();
  const raw = readData(idPath(tag, 'tags/worldgen/biome'));
  const entries = [];
  if (raw) {
    for (const value of JSON.parse(raw).values ?? []) entries.push(typeof value === 'string' ? value : value.id);
  }
  entries.push(...(kubeAdds.get(tag) ?? []));
  for (const entry of entries) {
    if (entry.startsWith('#')) for (const id of resolveTag(entry.slice(1), seen)) out.add(id);
    else out.add(entry);
  }
  tagCache.set(tag, out);
  return out;
}

/**
 * Every biome id this pack has, in every dimension.
 *
 * The filter exists to drop ids for biomes that are not in the pack at all, so its list has to
 * cover the whole pack. Using only `biomes.json` (the overworld's 109) silently emptied every
 * Moon and Beneath structure's biome list, which reads on the map as "generates everywhere".
 */
const knownBiomes = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'src/data/tfg/biomes.json'), 'utf8')).colors),
);
for (const file of fs.readdirSync(path.join(root, 'src/data/tfg/dimensions'))) {
  const dim = JSON.parse(fs.readFileSync(path.join(root, 'src/data/tfg/dimensions', file), 'utf8'));
  for (const entry of dim.biomes ?? []) knownBiomes.add(entry.biome);
}

/** Selectors that resolved to nothing, so a silent empty list is a loud line at the end instead. */
const emptySelectors = new Set();

const biomesOf = (selector) => {
  const ids = selector.startsWith('#') ? [...resolveTag(selector.slice(1))] : [selector];
  const kept = ids.filter((id) => knownBiomes.has(id)).sort();
  if (kept.length === 0) emptySelectors.add(`${selector} (${ids.length} ids before filtering)`);
  return kept;
};

// --- lithostitched spawn conditions ---------------------------------------------------------------
const conditions = new Map();
for (const file of walk(kubeData).filter((f) => f.includes(`lithostitched${path.sep}worldgen_modifier`))) {
  const modifier = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (modifier.type !== 'lithostitched:set_structure_spawn_condition') continue;
  const c = modifier.spawn_condition;
  let condition;
  if (c.type === 'lithostitched:grid' && c.condition?.type === 'lithostitched:in_biome') {
    condition = {
      type: 'avoid_biomes',
      biomes: biomesOf(c.condition.biomes),
      radius: c.radius,
      step: c.distance_between_points,
      allowedCount: c.allowed_count,
    };
  } else if (c.type === 'lithostitched:height_filter') {
    const range = Array.isArray(c.permitted_range)
      ? { min: c.permitted_range[0], max: c.permitted_range[1] }
      : { min: c.permitted_range.min_inclusive, max: c.permitted_range.max_inclusive };
    condition = { type: 'height', heightmap: c.heightmap, ...range };
  } else {
    condition = { type: 'unsupported', raw: c.type };
  }
  for (const structure of modifier.structures) {
    const list = conditions.get(structure) ?? [];
    list.push(condition);
    conditions.set(structure, list);
  }
}

// --- structure sets -------------------------------------------------------------------------------
/** Folder -> the dimension its sets belong to. A set is not portable between dimensions: the
 *  structures inside it name biomes that only exist in one, so the dimension is part of the data. */
const SET_DIRS = [
  ['tfg/worldgen/structure_set/aqueduct', 'overworld'],
  ['tfg/worldgen/structure_set/illagers', 'overworld'],
  ['tfg/worldgen/structure_set/mineshaft', 'overworld'],
  ['tfg/worldgen/structure_set/ocean', 'overworld'],
  ['tfg/worldgen/structure_set/temperate', 'overworld'],
  ['tfc_ruins/worldgen/structure_set', 'overworld'],
  ['tfc_ruined_world/worldgen/structure_set', 'overworld'],
  ['tfg/worldgen/structure_set/beneath', 'nether'],
  ['tfg/worldgen/structure_set/moon', 'moon'],
];

const sets = [];
for (const [dir, dimension] of SET_DIRS) {
  for (const name of fs.readdirSync(path.join(kubeData, dir)).filter((n) => n.endsWith('.json')).sort()) {
    const text = fs.readFileSync(path.join(kubeData, dir, name), 'utf8');
    const set = JSON.parse(text);
    const rawSalt = /"salt"\s*:\s*(-?\d+)/.exec(text)?.[1];
    const p = set.placement;
    const namespace = dir.split('/')[0];
    const setId = `${namespace}:${path.relative(path.join(namespace, 'worldgen/structure_set'), path.join(dir, name)).replace(/\\/g, '/').replace(/\.json$/, '')}`;
    sets.push({
      id: setId,
      dimension,
      placement: {
        type: p.type,
        salt: toInt32(rawSalt),
        spacing: p.spacing,
        separation: p.separation,
        spreadType: p.spread_type ?? 'linear',
        ...(p.frequency !== undefined ? { frequency: p.frequency } : {}),
        ...(p.exclusion_zone ? { exclusionZone: { otherSet: p.exclusion_zone.other_set, chunkCount: p.exclusion_zone.chunk_count } } : {}),
        ...(p.climate ? { climate: p.climate } : {}),
      },
      structures: set.structures.map(({ structure, weight }) => {
        const raw = readData(idPath(structure, 'worldgen/structure'));
        if (!raw) throw new Error(`structure ${structure} not found in KubeJS data or jars`);
        const def = JSON.parse(raw);
        return {
          id: structure,
          weight,
          type: def.type,
          biomes: biomesOf(def.biomes),
          conditions: conditions.get(structure) ?? [],
        };
      }),
    });
  }
}

/**
 * Sets referenced by an exclusion zone that we do not otherwise carry.
 *
 * `ExclusionZone#isPlacementForbidden` asks only where the other set *could* start, never whether
 * anything generates there, so a placement is the whole of what is needed. They are written with an
 * empty `structures` list, which means they can gate another set and can never draw a marker of
 * their own. Without this, the Beneath's tower is drawn 2 times in 19 where the game puts nothing,
 * because vanilla's `minecraft:nether_complexes` really does stand in its way.
 */
for (let added = true; added; ) {
  added = false;
  for (const set of [...sets]) {
    const other = set.placement.exclusionZone?.otherSet;
    if (other === undefined || sets.some((candidate) => candidate.id === other)) continue;
    const raw = readData(idPath(other, 'worldgen/structure_set'));
    if (!raw) {
      console.warn(`  ! ${set.id} excludes ${other}, which is in neither KubeJS nor any jar`);
      continue;
    }
    const p = JSON.parse(raw).placement;
    sets.push({
      id: other,
      dimension: set.dimension,
      placement: {
        type: p.type,
        salt: toInt32(String(p.salt)),
        spacing: p.spacing,
        separation: p.separation,
        spreadType: p.spread_type ?? 'linear',
        ...(p.frequency !== undefined ? { frequency: p.frequency } : {}),
        ...(p.exclusion_zone
          ? { exclusionZone: { otherSet: p.exclusion_zone.other_set, chunkCount: p.exclusion_zone.chunk_count } }
          : {}),
      },
      structures: [],
    });
    added = true;
  }
}

const out = {
  _source: `Extracted by tools/extract-tfg-structures.mjs from TerraFirmaGreg Modern KubeJS data and the modpack jars (${JARS.map((j) => path.basename(j)).join(', ')}). Regenerate rather than edit.`,
  sets,
};
const target = path.join(root, 'src/data/tfg/structures.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path.relative(root, target)}: ${sets.length} sets`);
if (emptySelectors.size > 0) {
  console.log('! biome selectors that resolved to nothing -- a structure with an empty list reads');
  console.log('! on the map as "generates in every biome", so each of these needs a look:');
  for (const selector of [...emptySelectors].sort()) console.log(`    ${selector}`);
}
for (const set of sets) {
  console.log(`  ${set.dimension.padEnd(10)} ${set.id.padEnd(34)} ${set.placement.type.padEnd(22)} ${set.structures.map((s) => `${s.id.split(':')[1]}(${s.biomes.length}b${s.conditions.length ? `,${s.conditions.map((c) => c.type).join('+')}` : ''})`).join(' ')}`);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
