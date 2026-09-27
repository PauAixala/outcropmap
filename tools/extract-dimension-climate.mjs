/**
 * The climate half of every non-overworld dimension, pulled out of the pack so the map can place
 * biomes in it.
 *
 * A `minecraft:noise` generator answers "which biome is at (x, y, z)?" in two pieces: a
 * `multi_noise` biome source holding a list of biomes each tagged with a box in six-dimensional
 * climate space, and a noise router whose six density functions say where in that space a position
 * lands. Both are data — mostly vanilla's, overridden by ad_astra's and TerraFirmaGreg's — so this
 * reads them rather than transcribing them.
 *
 * Three layers, later winning: the vanilla jar's `data/`, then every mod jar's, then the instance's
 * `kubejs/data/`, which is how TerraFirmaGreg rebuilds the Nether under `minecraft:the_nether`.
 *
 * Density functions are **inlined**: a reference like `tfg:nether/top_biome_noise` is replaced by the
 * function it names, transitively, so the runtime never resolves a registry. Anything the runtime
 * cannot evaluate is reported by type and count — a new pack tells us what it did not understand
 * instead of returning a plausible zero.
 *
 * A router entry is only written out if it can change the answer. When every biome claims the same
 * interval on an axis, that axis adds the same distance to each of them, so no value of it can
 * change which biome wins: the entry is written as 0 and listed in `_meta`. This is also why no
 * Ad Astra function ships — every Moon biome pins `depth` to 0 (NOTICE.md section 6).
 *
 *   node tools/extract-dimension-climate.mjs [--instance <dir>] [--jar <vanilla jar>] [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './lib/read-zip.mjs';
import { portableSource, resolveInstance, resolveVanillaJar } from './lib/portable-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const instance = resolveInstance(arg('instance', undefined), { tool: 'extract-dimension-climate' });
const vanillaJar = resolveVanillaJar(arg('jar', undefined), { tool: 'extract-dimension-climate' });
const outDir = arg('out', path.join(root, 'src/data/tfg/dimensions'));

/** Which dimensions are worth extracting, and what we call them. */
const DIMENSIONS = [
  ['minecraft:the_nether', 'beneath'],
  ['ad_astra:moon', 'moon'],
  ['ad_astra:mars', 'mars'],
  ['ad_astra:venus', 'venus'],
  ['ad_astra:glacio', 'glacio'],
];

// ---------------------------------------------------------------------------- the data index

/** `data/<ns>/<kind>/<path>.json` -> parsed JSON, later sources overriding earlier ones. */
const data = new Map();
const wanted = (n) => n.startsWith('data/') && n.endsWith('.json');

function addJar(file) {
  let added = 0;
  for (const [name, text] of readZip(file, wanted)) {
    try {
      data.set(name.slice('data/'.length, -'.json'.length), JSON.parse(text));
      added++;
    } catch {
      // A malformed JSON in some mod is not this tool's problem; the report catches what matters.
    }
  }
  return added;
}

function addDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, `${rel}${e.name}/`);
      else if (e.name.endsWith('.json')) {
        try {
          data.set(rel + e.name.slice(0, -'.json'.length), JSON.parse(fs.readFileSync(full, 'utf8')));
          added++;
        } catch {
          /* same */
        }
      }
    }
  };
  walk(dir, '');
  return added;
}

console.log(`vanilla jar: ${addJar(vanillaJar)} files`);
const modsDir = path.join(instance, 'mods');
let modFiles = 0;
for (const f of fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'))) {
  modFiles += addJar(path.join(modsDir, f));
}
console.log(`mod jars: ${modFiles} files`);
console.log(`kubejs: ${addDir(path.join(instance, 'kubejs/data'))} files`);

/** `tfg:nether/depth_noise` under kind `worldgen/density_function`. */
function lookup(kind, id) {
  const [ns, p] = id.includes(':') ? id.split(':', 2) : ['minecraft', id];
  return data.get(`${ns}/${kind}/${p}`) ?? null;
}

// ---------------------------------------------------------------- density functions, inlined

/** Types whose arguments are themselves density functions, and which fields hold them. */
const CHILDREN = {
  'minecraft:abs': ['argument'],
  'minecraft:square': ['argument'],
  'minecraft:cube': ['argument'],
  'minecraft:half_negative': ['argument'],
  'minecraft:quarter_negative': ['argument'],
  'minecraft:squeeze': ['argument'],
  'minecraft:flat_cache': ['argument'],
  'minecraft:cache_2d': ['argument'],
  'minecraft:cache_once': ['argument'],
  'minecraft:cache_all_in_cell': ['argument'],
  'minecraft:interpolated': ['argument'],
  'minecraft:blend_density': ['argument'],
  'minecraft:add': ['argument1', 'argument2'],
  'minecraft:mul': ['argument1', 'argument2'],
  'minecraft:min': ['argument1', 'argument2'],
  'minecraft:max': ['argument1', 'argument2'],
  'minecraft:clamp': ['input'],
  'minecraft:range_choice': ['input', 'when_in_range', 'when_out_of_range'],
  'minecraft:shifted_noise': ['shift_x', 'shift_y', 'shift_z'],
  'minecraft:weird_scaled_sampler': ['input'],
  'minecraft:spline': [],
  'minecraft:noise': [],
  'minecraft:shift': [],
  'minecraft:shift_a': [],
  'minecraft:shift_b': [],
  'minecraft:y_clamped_gradient': [],
  'minecraft:constant': [],
  'minecraft:end_islands': [],
  'minecraft:blend_alpha': [],
  'minecraft:blend_offset': [],
  'minecraft:old_blended_noise': [],
};

/** Fields that name a `worldgen/noise` rather than a density function. `shift_a`/`shift_b` put
 *  theirs under `argument`, which is the field name every other type uses for a child function —
 *  reading it as one is how `minecraft:offset` went uncollected on the first run. */
const NOISE_FIELDS = ['noise', 'input_noise'];
const NOISE_ARGUMENT = new Set(['minecraft:shift', 'minecraft:shift_a', 'minecraft:shift_b']);

const noises = new Map();
/** Every named density function inlined into the current dimension, for its `_meta`. */
const referenced = new Set();
const unsupported = new Map();

function note(type) {
  unsupported.set(type, (unsupported.get(type) ?? 0) + 1);
}

/** Splines nest density functions in their `coordinate` and their points' nested splines. */
function inlineSpline(spline, seen) {
  if (typeof spline === 'number') return spline;
  return {
    coordinate: inlineFunction(spline.coordinate, seen),
    points: (spline.points ?? []).map((p) => ({
      location: p.location,
      derivative: p.derivative,
      value: inlineSpline(p.value, seen),
    })),
  };
}

function inlineFunction(node, seen = []) {
  if (typeof node === 'number') return { type: 'minecraft:constant', argument: node };
  if (typeof node === 'string') {
    if (seen.includes(node)) throw new Error(`density function cycle at ${node}`);
    const resolved = lookup('worldgen/density_function', node);
    if (resolved === null) {
      note(`(missing) ${node}`);
      return { type: 'minecraft:constant', argument: 0 };
    }
    referenced.add(node.includes(':') ? node : `minecraft:${node}`);
    return inlineFunction(resolved, [...seen, node]);
  }
  if (node === null || typeof node !== 'object') throw new Error(`not a density function: ${node}`);

  const type = node.type;
  const fields = CHILDREN[type];
  if (fields === undefined) note(type);

  const out = { ...node };
  for (const field of fields ?? []) {
    if (out[field] !== undefined) out[field] = inlineFunction(out[field], seen);
  }
  if (type === 'minecraft:spline' && out.spline !== undefined) {
    out.spline = inlineSpline(out.spline, seen);
  }
  for (const key of NOISE_ARGUMENT.has(type) ? ['argument'] : NOISE_FIELDS) {
    const id = out[key];
    if (typeof id !== 'string' || noises.has(id)) continue;
    const params = lookup('worldgen/noise', id);
    if (params === null) note(`(missing noise) ${id}`);
    else noises.set(id, { firstOctave: params.firstOctave, amplitudes: params.amplitudes });
  }
  return out;
}

// ------------------------------------------------------------------------------- the biomes

/** A `multi_noise` source is either an explicit list or a named preset; only the list is data. */
function biomesOf(source) {
  if (source.type !== 'minecraft:multi_noise') throw new Error(`biome source is ${source.type}`);
  if (source.preset !== undefined) throw new Error(`biome source is the preset ${source.preset}`);
  return source.biomes.map((b) => ({ biome: b.biome, parameters: b.parameters }));
}

// ------------------------------------------------------------------------------------- run

const PARAMS = ['temperature', 'vegetation', 'continents', 'erosion', 'depth', 'ridges'];

/** The biome parameter each router entry is measured against (`Climate.ParameterPoint`). */
const PARAMETER_OF = {
  temperature: 'temperature',
  vegetation: 'humidity',
  continents: 'continentalness',
  erosion: 'erosion',
  depth: 'depth',
  ridges: 'weirdness',
};

/** One biome's claim on one axis as `[min, max]`; the datapack writes a point as a bare number. */
function interval(value, biome, axis) {
  if (typeof value === 'number') return [value, value];
  if (Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number')) {
    return [value[0], value[1]];
  }
  throw new Error(`${biome}: unexpected ${axis} parameter ${JSON.stringify(value)}`);
}

/**
 * Whether a router entry can change which biome wins. `Climate.Parameter#distance` is zero inside
 * an interval and the overshoot outside it, so an axis every biome claims alike adds the same
 * amount to every biome's fitness, and the nearest box stays the nearest whatever the entry says.
 */
function decides(biomes, key) {
  const axis = PARAMETER_OF[key];
  const claims = new Set(
    biomes.map((b) => JSON.stringify(interval(b.parameters[axis], b.biome, axis))),
  );
  return claims.size > 1;
}

/** The pack's name and version, when the launcher left a CurseForge `manifest.json` behind. */
function packOf(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
      return `${manifest.name} ${manifest.version}`;
    }
  } catch {
    // No manifest, or another launcher's: the sources below still say where the data came from.
  }
  return undefined;
}

const sources = [
  portableSource(vanillaJar),
  portableSource(path.join(instance, 'mods')),
  portableSource(path.join(instance, 'kubejs/data')),
];
const pack = packOf(instance);

fs.mkdirSync(outDir, { recursive: true });
const index = [];

for (const [dimensionId, name] of DIMENSIONS) {
  const dimension = lookup('dimension', dimensionId);
  if (dimension === null) {
    console.log(`${name}: no dimension file`);
    continue;
  }
  // TerraFirmaGreg wraps every dimension in `kubejs_tfc:wrapped`, which carries its own TFC
  // settings and nests the real `minecraft:noise` generator underneath.
  let generator = dimension.generator;
  while (generator?.generator !== undefined) generator = generator.generator;
  if (generator?.type !== 'minecraft:noise') {
    console.log(`${name}: generator is ${generator?.type}, skipped`);
    continue;
  }
  const settings =
    typeof generator.settings === 'string'
      ? lookup('worldgen/noise_settings', generator.settings)
      : generator.settings;
  if (settings === null) throw new Error(`${name}: no noise settings ${generator.settings}`);

  const biomes = biomesOf(generator.biome_source);

  // An entry that cannot decide is written as 0 (see `decides`). One biome is the extreme case:
  // Glacio's router alone is 117 KB of inlined splines that no lookup would ever read.
  noises.clear();
  referenced.clear();
  const router = {};
  const constant = [];
  for (const key of PARAMS) {
    if (decides(biomes, key)) {
      router[key] = inlineFunction(settings.noise_router[key] ?? 0);
    } else {
      router[key] = 0;
      constant.push(key);
    }
  }
  const out = {
    _meta: {
      tool: 'tools/extract-dimension-climate.mjs',
      sources,
      pack,
      constant_router_entries: constant,
      constant_router_entries_note:
        'Written as 0, not inlined: every biome claims the same interval on these axes, so they add ' +
        'the same distance to every biome and cannot change which one the climate search picks.',
      density_functions: [...referenced].sort(),
    },
    id: dimensionId,
    seaLevel: settings.sea_level,
    // Which random source seeds the noises. TerraFirmaGreg's Beneath asks for the legacy one, which
    // is a different algorithm end to end, not a detail.
    legacyRandomSource: settings.legacy_random_source === true,
    minY: settings.noise.min_y,
    height: settings.noise.height,
    router,
    noises: Object.fromEntries([...noises].sort(([a], [b]) => (a < b ? -1 : 1))),
    biomes,
  };
  const file = path.join(outDir, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
  index.push(name);
  console.log(
    `${name}: ${biomes.length} biomes, ${noises.size} noises, ${(fs.statSync(file).size / 1024).toFixed(1)} KB` +
      (constant.length > 0 ? `, written as 0: ${constant.join(' ')}` : ''),
  );
}

if (unsupported.size > 0) {
  console.log('\nunsupported / missing, by count:');
  for (const [type, count] of [...unsupported].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${type}`);
  }
}
console.log(`\nwrote ${index.length} dimensions to ${path.relative(root, outDir)}`);
