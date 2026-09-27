#!/usr/bin/env node
/**
 * Extracts which river valley each TerraFirmaGreg biome carves, from `TFGBiomes.java`.
 *
 * A river column's surface height is not the surrounding land's: the game carves a valley whose
 * shape depends on the biome around it. TFG declares that per biome as
 * `riverType(TFGRiverBlendType.X, builder()...)`, with **eleven** valley shapes where TFC has five
 * — its own `TFGRiverBlendType`, with banked, floodplain, talus and terraces on top of TFC's set.
 *
 * Without this table the `tfg` profile carved nothing, and a column in `tfg:earth/river` came out
 * **15.04 blocks too high** (measured against Pau's save; every other biome was under 2.8). Hand
 * transcribing 109 biomes would be 109 chances to put a canyon where a floodplain belongs, so it
 * comes out of the source like the height table next door — AGENTS.md section 4, data not code.
 *
 * Usage: node tools/extract-tfg-river-types.mjs [path-to-tfg-core-checkout]
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

// Each registration spans several lines; split on `register("` and take up to the next one, the
// same shape as extract-tfg-biome-heights.mjs.
const chunks = java.split('register("').slice(1);
const biomes = {};
let withType = 0;
for (const chunk of chunks) {
  const name = chunk.slice(0, chunk.indexOf('"'));
  // Three helpers carry the river type, not one: plain biomes use `riverType(...)`, shores use
  // `shoreType(type, shoreBlend, ...)` and volcanic biomes `cinderConesType(type, ...)`. Matching
  // only the first found 71 of the 95 declarations and quietly called the other 24 NONE.
  const match = /(?:riverType|shoreType|cinderConesType)\(\s*TFGRiverBlendType\.([A-Z_]+)/.exec(chunk);
  // A biome registered without `riverType(...)` keeps the builder default, which is NONE.
  biomes[name] = match ? match[1] : 'NONE';
  if (match) withType++;
}

// The enum's own declaration order is the order the samplers are built in, and each one consumes
// `Seed.next()` calls — so the order is part of the data, not a detail.
const enumSource = readFileSync(
  path.join(checkout, 'src/main/java/su/terrafirmagreg/core/world/new_ow_wg/rivers/TFGRiverBlendType.java'),
  'utf8',
);
const order = [...enumSource.matchAll(/^\s{4}([A-Z_]+)\(/gm)].map((m) => m[1]);

const output = {
  _meta: {
    description:
      "Each TFG biome's river valley shape, extracted verbatim from TFGBiomes.java, plus the " +
      'declaration order of TFGRiverBlendType — the samplers are built in that order from one ' +
      'Seed, so the order decides every noise seed.',
    source: portableSource(source),
    extraction_date: new Date().toISOString(),
    biome_count: Object.keys(biomes).length,
    declared: withType,
    types: Object.fromEntries(
      order.map((type) => [type, Object.values(biomes).filter((t) => t === type).length]),
    ),
  },
  order,
  biomes,
};

const out = path.join(ROOT, 'src', 'data', 'tfg', 'biome-rivers.json');
writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`${Object.keys(biomes).length} biomes (${withType} with an explicit river type)`);
console.log(`types in enum order: ${order.join(', ')}`);
console.log(`wrote ${path.relative(ROOT, out)}`);
