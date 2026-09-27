#!/usr/bin/env node
/**
 * Extracts which height function each TerraFirmaGreg biome uses, from `TFGBiomes.java`.
 *
 * TFG registers 109 biomes, each with a `.heightmap(...)` naming the noise function that shapes its
 * terrain. Transcribing that table by hand would be 109 chances to typo a biome into the wrong
 * landscape, and it would rot the next time TFG changes one. So it comes out of the source, the same
 * way vein and recipe tables do (AGENTS.md section 4: data, not code).
 *
 * TFG's heightmaps are **compositions**, not flat calls — a TFG landform wrapping a TFC base:
 *
 *   .heightmap(BiomeNoise::lowlands)
 *   .heightmap(seed -> TFGBiomeNoise.sharpHills(seed, 10, 40))
 *   .heightmap(seed -> TFGBiomeNoise.fenglin(seed, BiomeNoise.hills(seed, 4, 8), 40))
 *
 * So this captures the **whole expression**, balanced across nested parentheses, rather than
 * flattening it to a function name and a list of numbers. A flattened table cannot express the
 * third line, and a table that silently dropped the inner `hills` would put a karst biome on the
 * wrong base terrain — plausible, and wrong.
 *
 * It also reports every distinct function each expression references, split by declaring class,
 * which is the inventory of what still has to be ported.
 *
 * Usage: node tools/extract-tfg-biome-heights.mjs [path-to-tfg-core-checkout]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableSource } from './lib/portable-path.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_CHECKOUT = path.join(ROOT, 'tools', '.cache', 'tfg-core-modern-0.9.21');
const checkout = process.argv[2] ?? DEFAULT_CHECKOUT;
const source = path.join(
  checkout,
  'src/main/java/su/terrafirmagreg/core/world/new_ow_wg/biome/TFGBiomes.java',
);

const java = readFileSync(source, 'utf8');

/**
 * Each registration spans several lines, so split on `register("` and take everything up to the
 * next one. Brace-matching would be more precise and is not needed: `.heightmap(` appears at most
 * once per registration.
 */
const chunks = java.split('register("').slice(1);

/** Reads a parenthesised argument list starting at `open` (the index of '('), respecting nesting. */
function readBalanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

const biomes = {};
let missingHeightmap = 0;

for (const chunk of chunks) {
  const name = chunk.slice(0, chunk.indexOf('"'));
  if (!/^[a-z0-9_]+$/.test(name)) continue;

  const marker = chunk.indexOf('.heightmap(');
  if (marker === -1) {
    missingHeightmap++;
    biomes[name] = null;
    continue;
  }

  const raw = readBalanced(chunk, marker + '.heightmap'.length);
  if (raw === null) {
    missingHeightmap++;
    biomes[name] = null;
    continue;
  }

  // Normalise whitespace so the expression is one readable line.
  const expression = raw.replace(/\s+/g, ' ').trim();
  // Every `Class.method` or `Class::method` the expression mentions. The owner must start with an
  // uppercase letter, or a decimal literal like `1.5` is read as a class named "1".
  const calls = [
    ...expression.matchAll(/([A-Z]\w*)(?:\.|::)(\w+)/g),
  ].map((match) => `${match[1]}.${match[2]}`);

  biomes[name] = { expression, calls: [...new Set(calls)] };
}

const entries = Object.entries(biomes);

/** Every distinct function referenced anywhere, grouped by declaring class. */
const functionsByOwner = {};
for (const [, value] of entries) {
  for (const call of value?.calls ?? []) {
    const [owner, fn] = call.split('.');
    (functionsByOwner[owner] ??= new Set()).add(fn);
  }
}
const functions = Object.fromEntries(
  Object.entries(functionsByOwner).map(([owner, set]) => [owner, [...set].sort()]),
);

const output = {
  _meta: {
    description:
      "Each TFG biome's height expression, extracted verbatim from TFGBiomes.java. " +
      'Expressions compose: a TFG landform often wraps a TFC base noise, so the whole expression ' +
      'is kept rather than a function name and arguments. `functions` is the inventory of what a ' +
      'port has to implement, split by declaring class: BiomeNoise is TFC own, TFGBiomeNoise and ' +
      'TFGNoiseHelpers belong to TerraFirmaGreg.',
    source: portableSource(source),
    extraction_date: new Date().toISOString(),
    biome_count: entries.length,
    functions,
    function_count: Object.fromEntries(
      Object.entries(functions).map(([owner, list]) => [owner, list.length]),
    ),
  },
  biomes,
};

const out = path.join(ROOT, 'src', 'data', 'tfg', 'biome-heights.json');
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);

console.log(`${entries.length} biomes -> src/data/tfg/biome-heights.json`);
console.log('functions to implement, by declaring class:', output._meta.function_count);
if (missingHeightmap > 0) console.log(`${missingHeightmap} with no .heightmap(...)`);
