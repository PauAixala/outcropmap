/**
 * The fill colours of the deposit markers: src/data/palettes/tfc-1.20-ores.json and tfg-ores.json.
 *
 * Our own UI design, not a port of anything. The JSON files are the source of truth — their
 * families and categories are written there by hand and checked against the map's own yields by
 * tests/unit/deposit-style.test.ts — and this tool only proposes and measures the colours.
 *
 *   node tools/ore-palettes.mjs           measure the committed colours, per (profile, dimension,
 *                                          category) group: the numbers the test holds them to
 *   node tools/ore-palettes.mjs --drift   the same, plus how far each family sits from its anchor
 *   node tools/ore-palettes.mjs --write   re-run the optimiser and write the colours back; with the
 *                                          default options this reproduces the committed files
 *
 * The optimiser is deterministic (fixed seeds) simulated annealing in OKLab, over the kinds each
 * dimension can draw with the same marker shape. Its terms, in the order the brief ranks them:
 * - floors, held hard: kinds of different families at least 0.08 apart (ΔE_OK, Euclidean in OKLab),
 *   and 0.03 apart under protanopia and deuteranopia (Machado et al. 2009, severity 1.0, in linear
 *   sRGB); variants of one family at least 0.04 apart; OKLab lightness within 0.40..0.93;
 * - semantic anchors: each family's base near the colour a player expects (copper orange, gold
 *   yellow, malachite green, ...), weighted by how much breaking it would be noticed (X > S > M > W);
 *   each kind near its family's base, variants spreading mostly in lightness;
 * - targets, strong but soft: 0.10 between families, 0.05 between variants, 0.05 under CVD. The
 *   CVD target is the softest, because the anchors' hues are only seen with normal colour vision.
 * In TerraFirmaGreg one base serves every dimension, so gold is the same gold on the Moon; a kind
 * moves off its family's base only where the distances in its own dimension demand it. After
 * rounding to 8-bit hex a greedy polish tries one-unit RGB steps, scored on the hex values.
 *
 * Imports the colour maths from src/core/color directly: Node 24 strips the types, and both modules
 * import nothing, so no build step or path alias is needed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  linearRgbToOklab,
  linearRgbToPacked,
  oklabToLinearRgb,
  packedToLinearRgb,
  packedToOklab,
} from '../src/core/color/oklab.ts';
import { simulateCvd } from '../src/core/color/cvd.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The floors the test enforces, and the targets the optimiser aims past (with rounding slack). */
export const LIMITS = {
  minL: 0.4,
  maxL: 0.93,
  family: { target: 0.1, floor: 0.08 },
  variant: { target: 0.05, floor: 0.04 },
  cvd: { target: 0.05, floor: 0.03 },
};

/**
 * What the optimiser aims for: each floor and target plus a margin for rounding to 8-bit hex. A
 * floor is held hard; a target is a strong preference that a semantic anchor may outweigh, as the
 * brief ranks them (floors, then anchors, then targets). `cohesion` caps how far apart two variants
 * of one family may drift (a five-kind family spread in lightness spans about 0.2, so this only
 * stops a variant wandering off to another hue).
 */
const AIM = {
  family: { floor: 0.085, target: 0.104 },
  variant: { floor: 0.045, target: 0.054 },
  cvd: { floor: 0.035, target: 0.054 },
  cohesion: 0.24,
};

const DIKES = new Set(['diorite_dike', 'gabbro_dike', 'granite_dike']);

const PROFILES = {
  'tfc-1.20': {
    palette: 'src/data/palettes/tfc-1.20-ores.json',
    dimensions: { overworld: 'src/data/tfc-1.20/veins.json' },
  },
  tfg: {
    palette: 'src/data/palettes/tfg-ores.json',
    dimensions: {
      overworld: 'src/data/tfg/veins.json',
      nether: 'src/data/tfg/veins-nether.json',
      moon: 'src/data/tfg/veins-moon.json',
      mars: 'src/data/tfg/veins-mars.json',
      venus: 'src/data/tfg/veins-venus.json',
    },
  },
};

/**
 * Semantic anchors: the colour a player expects for a material, and how hard to hold it there.
 * X: the anchors a player would notice breaking (copper orange, gold yellow, malachite green, lapis
 * blue, coal near-black, kaolin near-white, ...). S: the common ores' own colours. M: a plausible
 * colour. W: no colour a player would expect (most of GregTech's late-game ores), so these give way
 * first and fill whatever room the others leave. An anchor holds hue hardest, chroma next and
 * lightness least, so a crowded family keeps its hue and moves in lightness. A floor always wins.
 */
const X = 40;
const S = 8;
const M = 2;
const W = 0.3;
const SHARED = {
  // Metal ores.
  copper: ['#c86a2c', X],
  native_copper: ['#c86a2c', X],
  gold: ['#e8b828', X],
  native_gold: ['#e8b828', X],
  silver: ['#c6cdd6', X],
  native_silver: ['#c6cdd6', X],
  hematite: ['#b23a2c', X],
  malachite: ['#1f9e5c', X],
  magnetite: ['#3f4146', S],
  // TerraFirmaGreg's main copper ore: brass, held as hard as copper itself.
  chalcopyrite: ['#b5a032', X],
  cassiterite: ['#6f4b36', S],
  galena: ['#a3acc4', S],
  bismuthinite: ['#cf8db6', S],
  bismuth: ['#cf8db6', S],
  garnierite: ['#8fc84f', M],
  cobaltite: ['#3b5bd0', S],
  bornite: ['#7c50b0', S],
  limonite: ['#c99a3e', S],
  yellow_limonite: ['#c99a3e', S],
  goethite: ['#8e5a26', M],
  tetrahedrite: ['#7d8798', M],
  kyanite: ['#6aa1e0', M],
  spodumene: ['#d9b5d9', M],
  electrotine: ['#47b6d0', M],
  almandine: ['#9b2a4a', M],
  pyrite: ['#c9b23e', M],
  sphalerite: ['#5a8fa8', W],
  chalcocite: ['#5b6573', W],
  lead: ['#6d6a8f', W],
  ilmenite: ['#5b4a5f', W],
  wulfenite: ['#ee8a22', W],
  scheelite: ['#e6dba0', W],
  bastnasite: ['#c97a6c', W],
  thorium: ['#5f7b5a', W],
  tarkianite: ['#8a8070', W],
  basaltic_mineral_sand: ['#5d5951', W],
  granitic_mineral_sand: ['#b9a59b', W],
  grossular: ['#c4606e', W],
  alunite: ['#e0d0c0', W],
  pyrolusite: ['#454550', W],
  pentlandite: ['#b39a52', W],
  irarsite: ['#a2aab3', W],
  pyrochlore: ['#8b4f31', W],
  chromite: ['#3e3f48', W],
  tungstate: ['#4c4c44', W],
  pitchblende: ['#4d5e3a', W],
  // Gems.
  sapphire: ['#2a52c8', X],
  amethyst: ['#9a5fd8', X],
  lapis_lazuli: ['#2f52c4', X],
  lazurite: ['#283a9e', X],
  emerald: ['#1fbf6a', X],
  diamond: ['#bdeef2', X],
  blue_topaz: ['#43b0e0', M],
  quartzite: ['#e6e1ec', M],
  opal: ['#f0e2ee', M],
  certus_quartz: ['#b9d9f2', M],
  nether_quartz: ['#ece0d4', M],
  // Non-metal minerals.
  kaolin: ['#f5f1ea', X],
  sulfur: ['#e6d630', X],
  redstone: ['#c81f1f', X],
  cinnabar: ['#c62f2f', S],
  graphite: ['#50535b', S],
  gypsum: ['#efe5cf', M],
  apatite: ['#4aa9c2', M],
  salt: ['#f0d6d6', M],
  halite: ['#f0d6d6', M],
  sylvite: ['#e0a07c', M],
  cryolite: ['#cfe6f2', M],
  realgar: ['#d2441f', M],
  gravel: ['#8b8781', M],
  fullers_earth: ['#c9b98f', W],
  saltpeter: ['#e6e8dc', W],
  mica: ['#a99a82', W],
  borax: ['#f2f2f6', W],
  tricalcium_phosphate: ['#dcc6a0', W],
  garnet_sand: ['#a2453f', W],
  phlogopite: ['#8b6b41', W],
  soapstone: ['#8ba292', W],
  trona: ['#d9d1b9', W],
  // Fuels.
  coal: ['#45464a', X],
  bituminous_coal: ['#45464a', X],
  lignite: ['#6c4f36', X],
  anthracite: ['#4f5068', M],
};

// --- colour helpers -------------------------------------------------------------------------

const hexToPacked = (hex) => Number.parseInt(hex.slice(1), 16);
const packedToHex = (packed) => `#${packed.toString(16).padStart(6, '0')}`;

/** OKLab as seen normally, under protanopia and under deuteranopia: 9 numbers. */
function views(L, a, b, out) {
  const rgb = oklabToLinearRgb(L, a, b);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const r = clamp(rgb.r);
  const g = clamp(rgb.g);
  const bl = clamp(rgb.b);
  const n = linearRgbToOklab(r, g, bl);
  const p = simulateCvd('protanopia', r, g, bl);
  const pl = linearRgbToOklab(p.r, p.g, p.b);
  const d = simulateCvd('deuteranopia', r, g, bl);
  const dl = linearRgbToOklab(d.r, d.g, d.b);
  out[0] = n.L; out[1] = n.a; out[2] = n.b;
  out[3] = pl.L; out[4] = pl.a; out[5] = pl.b;
  out[6] = dl.L; out[7] = dl.a; out[8] = dl.b;
  return out;
}

function packedViews(packed) {
  const lab = packedToOklab(packed);
  const rgb = packedToLinearRgb(packed);
  const p = simulateCvd('protanopia', rgb.r, rgb.g, rgb.b);
  const pl = linearRgbToOklab(p.r, p.g, p.b);
  const d = simulateCvd('deuteranopia', rgb.r, rgb.g, rgb.b);
  const dl = linearRgbToOklab(d.r, d.g, d.b);
  return [lab.L, lab.a, lab.b, pl.L, pl.a, pl.b, dl.L, dl.a, dl.b];
}

const dist = (u, i, v, j) => Math.hypot(u[i] - v[j], u[i + 1] - v[j + 1], u[i + 2] - v[j + 2]);

/** Clamps lightness to the limits and pulls chroma in (hue kept) until the colour is in gamut. The
 *  lightness margin keeps the 8-bit rounding of the final hex inside the limits. */
function project(lab) {
  lab.L = Math.min(LIMITS.maxL - 0.0025, Math.max(LIMITS.minL + 0.0025, lab.L));
  const inGamut = (s) => {
    const rgb = oklabToLinearRgb(lab.L, lab.a * s, lab.b * s);
    const lo = 0.0004;
    const hi = 0.9996;
    return rgb.r >= lo && rgb.r <= hi && rgb.g >= lo && rgb.g <= hi && rgb.b >= lo && rgb.b <= hi;
  };
  if (inGamut(1)) return lab;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(mid)) lo = mid;
    else hi = mid;
  }
  lab.a *= lo;
  lab.b *= lo;
  return lab;
}

/** Deterministic PRNG (mulberry32). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- data -----------------------------------------------------------------------------------

function readJson(path) {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

/** Canonical id of a vein the way the ports report it: a cluster's table key, otherwise its
 *  `random_name` (`kaolin_disc` reports `kaolin`). */
const canonicalId = (key, vein) => (vein.type === 'cluster' ? key : vein.random_name);

/** Every kind of a profile, with the dimension whose vein table holds it. */
function loadKinds(name) {
  const config = PROFILES[name];
  const palette = readJson(config.palette);
  const kinds = [];
  for (const [dimension, file] of Object.entries(config.dimensions)) {
    for (const [key, vein] of Object.entries(readJson(file).veins)) {
      if (DIKES.has(key)) continue;
      const id = canonicalId(key, vein);
      const entry = palette.ores[id];
      if (entry === undefined) throw new Error(`${name}: ${id} has no palette entry`);
      kinds.push({ id, dimension, family: entry.family, category: entry.category, color: entry.color });
    }
  }
  return { palette, kinds };
}

/** Kinds grouped by (dimension, category): the sets whose markers share a shape on one map. */
function groupsOf(kinds) {
  const groups = new Map();
  kinds.forEach((kind, index) => {
    const key = `${kind.dimension}/${kind.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  return groups;
}

// --- measuring ------------------------------------------------------------------------------

function measure(name, kinds) {
  const viewsOf = kinds.map((kind) => packedViews(hexToPacked(kind.color)));
  const report = [];
  for (const [key, members] of [...groupsOf(kinds)].sort(([a], [b]) => a.localeCompare(b))) {
    const families = new Set(members.map((i) => kinds[i].family));
    const best = { normal: [Infinity], protan: [Infinity], deutan: [Infinity], variant: [Infinity] };
    const keep = (slot, value, i, j) => {
      if (value < best[slot][0]) best[slot] = [value, kinds[i].id, kinds[j].id];
    };
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x];
        const j = members[y];
        const u = viewsOf[i];
        const v = viewsOf[j];
        if (kinds[i].family === kinds[j].family) {
          keep('variant', dist(u, 0, v, 0), i, j);
        } else {
          keep('normal', dist(u, 0, v, 0), i, j);
          keep('protan', dist(u, 3, v, 3), i, j);
          keep('deutan', dist(u, 6, v, 6), i, j);
        }
      }
    }
    const ls = members.map((i) => viewsOf[i][0]);
    report.push({
      group: `${name}/${key}`,
      kinds: members.length,
      families: families.size,
      ...best,
      minL: Math.min(...ls),
      maxL: Math.max(...ls),
    });
  }
  return report;
}

function printReport(report) {
  const fmt = (slot) =>
    slot[0] === Infinity ? '   -  ' : `${slot[0].toFixed(4)} (${slot[1]} ~ ${slot[2]})`;
  for (const row of report) {
    console.log(`${row.group}: ${row.kinds} kinds, ${row.families} families, L ${row.minL.toFixed(2)}..${row.maxL.toFixed(2)}`);
    console.log(`  normal  ${fmt(row.normal)}`);
    console.log(`  protan  ${fmt(row.protan)}`);
    console.log(`  deutan  ${fmt(row.deutan)}`);
    console.log(`  variant ${fmt(row.variant)}`);
  }
}

// --- optimising -----------------------------------------------------------------------------

function optimise(name, kinds, { iterations = ITERATIONS, seed = 20261101 } = {}) {
  const random = rng(seed);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const familyNames = [...new Set(kinds.map((kind) => kind.family))].sort();
  const families = familyNames.map((family) => {
    const anchor = SHARED[family];
    if (anchor === undefined) throw new Error(`${name}: no anchor for family ${family}`);
    const lab = project(packedToOklab(hexToPacked(anchor[0])));
    return {
      name: family,
      anchor: [lab.L, lab.a, lab.b],
      weight: anchor[1],
      base: [lab.L, lab.a, lab.b],
      kinds: [],
    };
  });
  const familyIndex = new Map(familyNames.map((family, index) => [family, index]));
  const groups = [...groupsOf(kinds).values()];
  const groupOf = new Array(kinds.length);
  groups.forEach((members, g) => members.forEach((i) => (groupOf[i] = g)));

  // Start every kind at its family's anchor, variants spread in lightness.
  const lab = kinds.map(() => [0, 0, 0]);
  const view = kinds.map(() => new Float64Array(9));
  const famOf = kinds.map((kind) => familyIndex.get(kind.family));
  kinds.forEach((kind, i) => families[famOf[i]].kinds.push(i));
  for (const members of groups) {
    const byFamily = new Map();
    for (const i of members) {
      if (!byFamily.has(famOf[i])) byFamily.set(famOf[i], []);
      byFamily.get(famOf[i]).push(i);
    }
    for (const [f, list] of byFamily) {
      list.forEach((i, k) => {
        const base = families[f].base;
        const offset = (k - (list.length - 1) / 2) * 0.06;
        const p = project({ L: base[0] + offset, a: base[1], b: base[2] });
        lab[i] = [p.L, p.a, p.b];
        views(p.L, p.a, p.b, view[i]);
      });
    }
  }

  const W_FLOOR = 20000;
  const W_TARGET = TARGET_WEIGHT;
  // The CVD target gives way to anchors more readily than the normal-vision one: an anchor's hue is
  // only seen with normal colour vision, where copper, brass, gold and ochre are four colours; under
  // protanopia and deuteranopia they are one yellow-brown, told apart by lightness alone.
  const W_TARGET_CVD = CVD_TARGET_WEIGHT;
  const W_COH = 200;
  const W_BASE = 10;
  const hinge = (x) => (x > 0 ? x * x : 0);
  /**
   * A colour difference split the way CIEDE-style metrics split it: lightness, chroma, and hue
   * (ΔH² = Δa² + Δb² - ΔC²), weighted so hue is held hardest and lightness least. Variants of one
   * family and a family's base against its anchor both use it: shades of one hue, not new hues.
   */
  const lch = (weights, L1, a1, b1, L2, a2, b2) => {
    const dL = L1 - L2;
    const da = a1 - a2;
    const db = b1 - b2;
    const c2 = Math.hypot(a2, b2);
    const dC = Math.hypot(a1, b1) - c2;
    const dH2 = Math.max(0, da * da + db * db - dC * dC);
    // A near-neutral reference (black, silver, white) has no hue to hold; its greyness is its
    // identity, so chroma is held as hard as hue is elsewhere.
    return weights[0] * dL * dL + (c2 < 0.03 ? weights[2] : weights[1]) * dC * dC + weights[2] * dH2;
  };
  /**
   * Lightness, chroma, hue. A family against its anchor holds all three, hue a little harder
   * (gold has to stay saturated and mid-light to read as gold, kaolin light to read as kaolin).
   * Variants of one family are held to its base loosely in lightness and moderately in hue: under
   * protanopia and deuteranopia lightness and the blue-yellow axis are all that is left, a grid of
   * roughly 5 x 11 cells at the 0.05 target, and a big group nearly fills it. Variants need no CVD
   * separation from each other, so letting them differ along the red-green axis (a nearby hue, as
   * brown and red-brown) leaves those cells to the other families.
   */
  const ANCHOR_WEIGHTS = [1, 1, 1.5];
  const VARIANT_WEIGHTS = [0.3, 1, 1.2];
  const both = (aim, d, target = W_TARGET) => W_FLOOR * hinge(aim.floor - d) + target * hinge(aim.target - d);
  const pairEnergy = (i, j) => {
    const u = view[i];
    const v = view[j];
    const dn = dist(u, 0, v, 0);
    if (famOf[i] === famOf[j]) return both(AIM.variant, dn) + W_COH * hinge(dn - AIM.cohesion);
    return (
      both(AIM.family, dn) +
      both(AIM.cvd, dist(u, 3, v, 3), W_TARGET_CVD) +
      both(AIM.cvd, dist(u, 6, v, 6), W_TARGET_CVD)
    );
  };
  // A kind is held to its family's base as firmly as the family is held to its anchor: a gold vein
  // on the Moon must not wander off just because gold in the overworld stayed put.
  const baseWeight = families.map((family) => W_BASE + 2 * family.weight);
  const baseEnergy = (i) => {
    const base = families[famOf[i]].base;
    const c = lab[i];
    return baseWeight[famOf[i]] * lch(VARIANT_WEIGHTS, c[0], c[1], c[2], base[0], base[1], base[2]);
  };
  const anchorEnergy = (f) => {
    const { base, anchor, weight } = families[f];
    return weight * lch(ANCHOR_WEIGHTS, base[0], base[1], base[2], anchor[0], anchor[1], anchor[2]);
  };
  const kindEnergy = (i) => {
    let e = baseEnergy(i);
    for (const j of groups[groupOf[i]]) if (j !== i) e += pairEnergy(i, j);
    return e;
  };
  const familyEnergy = (f, withPairs) => {
    let e = anchorEnergy(f);
    for (const i of families[f].kinds) {
      e += baseEnergy(i);
      if (withPairs) for (const j of groups[groupOf[i]]) if (j !== i) e += pairEnergy(i, j);
    }
    return e;
  };

  const T0 = 0.02;
  const T1 = 1e-7;
  const S0 = 0.05;
  const S1 = 0.0015;
  const saved = new Float64Array(9);
  for (let t = 0; t < iterations; t++) {
    const progress = t / iterations;
    const temperature = T0 * (T1 / T0) ** progress;
    const sigma = S0 * (S1 / S0) ** progress;
    const roll = random();
    if (roll < 0.7) {
      // Move one kind.
      const i = Math.floor(random() * kinds.length);
      const before = kindEnergy(i);
      const old = lab[i];
      saved.set(view[i]);
      const p = project({ L: old[0] + gauss() * sigma, a: old[1] + gauss() * sigma, b: old[2] + gauss() * sigma });
      lab[i] = [p.L, p.a, p.b];
      views(p.L, p.a, p.b, view[i]);
      const delta = kindEnergy(i) - before;
      if (delta > 0 && random() >= Math.exp(-delta / temperature)) {
        lab[i] = old;
        view[i].set(saved);
      }
    } else if (roll < 0.85) {
      // Move one family's base.
      const f = Math.floor(random() * families.length);
      const before = familyEnergy(f, false);
      const old = families[f].base;
      const p = project({ L: old[0] + gauss() * sigma, a: old[1] + gauss() * sigma, b: old[2] + gauss() * sigma });
      families[f].base = [p.L, p.a, p.b];
      const delta = familyEnergy(f, false) - before;
      if (delta > 0 && random() >= Math.exp(-delta / temperature)) families[f].base = old;
    } else {
      // Move a whole family: its base and every kind of it, in every dimension.
      const f = Math.floor(random() * families.length);
      const members = families[f].kinds;
      const before = familyEnergy(f, true);
      const dL = gauss() * sigma;
      const da = gauss() * sigma;
      const db = gauss() * sigma;
      const oldBase = families[f].base;
      const oldLab = members.map((i) => lab[i]);
      const oldViews = members.map((i) => Float64Array.from(view[i]));
      const b = project({ L: oldBase[0] + dL, a: oldBase[1] + da, b: oldBase[2] + db });
      families[f].base = [b.L, b.a, b.b];
      for (const i of members) {
        const p = project({ L: lab[i][0] + dL, a: lab[i][1] + da, b: lab[i][2] + db });
        lab[i] = [p.L, p.a, p.b];
        views(p.L, p.a, p.b, view[i]);
      }
      const delta = familyEnergy(f, true) - before;
      if (delta > 0 && random() >= Math.exp(-delta / temperature)) {
        families[f].base = oldBase;
        members.forEach((i, k) => {
          lab[i] = oldLab[k];
          view[i].set(oldViews[k]);
        });
      }
    }
  }

  // Round to 8-bit hex, then polish on the hex values themselves: rounding can move a pair that sat
  // just above a target to just under it, so try every one-step neighbour of each colour (one unit
  // up or down in any of R, G, B) and keep a step whenever it lowers the exact energy.
  const packedOf = kinds.map((_kind, i) => {
    const rgb = oklabToLinearRgb(lab[i][0], lab[i][1], lab[i][2]);
    return linearRgbToPacked(rgb.r, rgb.g, rgb.b);
  });
  const place = (i, packed) => {
    const rounded = packedToOklab(packed);
    lab[i] = [rounded.L, rounded.a, rounded.b];
    view[i].set(packedViews(packed));
  };
  packedOf.forEach((packed, i) => place(i, packed));
  const inLimits = (packed) => {
    const L = packedToOklab(packed).L;
    return L >= LIMITS.minL && L <= LIMITS.maxL;
  };
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < kinds.length; i++) {
      let bestPacked = packedOf[i];
      let bestEnergy = kindEnergy(i);
      const r0 = (bestPacked >> 16) & 0xff;
      const g0 = (bestPacked >> 8) & 0xff;
      const b0 = bestPacked & 0xff;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dg = -1; dg <= 1; dg++) {
          for (let db = -1; db <= 1; db++) {
            if (dr === 0 && dg === 0 && db === 0) continue;
            const r = r0 + dr;
            const g = g0 + dg;
            const b = b0 + db;
            if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) continue;
            const candidate = (r << 16) | (g << 8) | b;
            if (!inLimits(candidate)) continue;
            place(i, candidate);
            const e = kindEnergy(i);
            if (e < bestEnergy - 1e-12) {
              bestEnergy = e;
              bestPacked = candidate;
            }
          }
        }
      }
      place(i, bestPacked);
      if (bestPacked !== packedOf[i]) {
        packedOf[i] = bestPacked;
        improved = true;
      }
    }
    if (!improved) break;
  }
  const colors = packedOf.map(packedToHex);
  let energy = 0;
  for (let f = 0; f < families.length; f++) energy += familyEnergy(f, false);
  for (const members of groups) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) energy += pairEnergy(members[x], members[y]);
    }
  }
  return { energy, kinds: kinds.map((kind, i) => ({ ...kind, color: colors[i] })) };
}

/** How far each family's kinds sit from its anchor, worst first: the semantic cost of the floors. */
function printDrift(kinds) {
  const byFamily = new Map();
  for (const kind of kinds) {
    if (!byFamily.has(kind.family)) byFamily.set(kind.family, []);
    byFamily.get(kind.family).push(kind);
  }
  const rows = [...byFamily].map(([family, list]) => {
    const anchor = packedViews(hexToPacked(SHARED[family][0]));
    const drift = Math.max(...list.map((kind) => dist(packedViews(hexToPacked(kind.color)), 0, anchor, 0)));
    return { family, drift, anchor: SHARED[family][0], colors: list.map((kind) => kind.color).join(' ') };
  });
  rows.sort((a, b) => b.drift - a.drift);
  for (const row of rows) {
    console.log(`  ${row.family.padEnd(22)} drift ${row.drift.toFixed(3)}  anchor ${row.anchor}  ${row.colors}`);
  }
}

// --- main -----------------------------------------------------------------------------------

/** How much a target shortfall costs against an anchor's drift; see AIM. */
const TARGET_WEIGHT = Number(
  process.argv.find((arg) => arg.startsWith('--target-weight='))?.slice('--target-weight='.length) ?? 1500,
);
const CVD_TARGET_WEIGHT = Number(
  process.argv.find((arg) => arg.startsWith('--cvd-target-weight='))?.slice('--cvd-target-weight='.length) ?? 120,
);
const ITERATIONS = Number(
  process.argv.find((arg) => arg.startsWith('--iterations='))?.slice('--iterations='.length) ?? 3_000_000,
);
const write = process.argv.includes('--write');
const showDrift = process.argv.includes('--drift');
const only = process.argv.find((arg) => arg.startsWith('--profile='))?.slice('--profile='.length);
const seeds = Number(process.argv.find((arg) => arg.startsWith('--seeds='))?.slice('--seeds='.length) ?? 3);
for (const name of Object.keys(PROFILES)) {
  if (only !== undefined && only !== name) continue;
  const { palette, kinds } = loadKinds(name);
  let result = kinds;
  if (write) {
    // A few independent runs; the lowest final energy wins. Deterministic: the seeds are fixed.
    let best = null;
    for (let s = 0; s < seeds; s++) {
      const run = optimise(name, kinds, { seed: 20261101 + s * 7919 });
      console.log(`${name}: seed ${s} energy ${run.energy.toFixed(5)}`);
      if (best === null || run.energy < best.energy) best = run;
    }
    result = best.kinds;
    for (const kind of result) palette.ores[kind.id].color = kind.color;
    writeFileSync(join(ROOT, PROFILES[name].palette), `${JSON.stringify(palette, null, 2)}\n`);
  }
  printReport(measure(name, result));
  if (showDrift) printDrift(result);
}
