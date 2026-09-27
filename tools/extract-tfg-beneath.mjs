#!/usr/bin/env node
/**
 * The Beneath's rock layers, out of the pack's own dimension file.
 *
 * TerraFirmaGreg rebuilds the Nether — what a player calls The Beneath — with TFC's chunk generator
 * rather than a vanilla noise one, so it carries its own `rock_layer_settings` in
 * `kubejs/data/minecraft/dimension/the_nether.json`. Same shape as the overworld's, different rocks:
 * deepslate, blackstone, crackrack and eleven more, stacked in their own order.
 *
 * Usage: node tools/extract-tfg-beneath.mjs --instance "<instance>"   (or --pack "<instance>/kubejs",
 *        or OUTCROP_INSTANCE in the environment)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableSource, resolveInstance } from './lib/portable-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const pack =
  arg('pack', null) ?? path.join(resolveInstance(arg('instance', undefined), { tool: 'extract-tfg-beneath' }), 'kubejs');
const source = path.join(pack, 'data/minecraft/dimension/the_nether.json');

const dimension = JSON.parse(fs.readFileSync(source, 'utf8'));
const settings = dimension.generator?.settings?.rock_layer_settings;
if (!settings) {
  console.error(`No rock_layer_settings in ${source}. The pack may define the Nether differently now.`);
  process.exit(1);
}

// `createRockLayerSampler` wants camelCase and the rock ids only; the dimension file spells the key
// `ocean_floor` and carries a block id per rock that the map does not use.
const out = {
  _meta: {
    // `path.relative` across drives returns the absolute path, which is how an instance folder on
    // D: ended up committed here. `<instance>/kubejs/...` instead.
    source: portableSource(source),
    extracted: new Date().toISOString(),
    dimension: dimension.type,
    note:
      'The Beneath is not a dimension of its own: the Beneath mod adds features to minecraft:the_nether ' +
      'and TerraFirmaGreg rebuilds that Nether with TFC machinery. This is that rebuild.',
    rocks: Object.keys(settings.rocks ?? {}).length,
  },
  bottom: settings.bottom ?? [],
  // The dimension file writes a layer's contents as `{ rock: parentLayer }`; the sampler wants the
  // pairs, the same shape `rock-layers.json` already ships in.
  layers: (settings.layers ?? []).map((layer) => ({
    id: layer.id,
    entries: Object.entries(layer.layers ?? {}),
  })),
  oceanFloor: settings.ocean_floor ?? [],
  land: settings.land ?? [],
  volcanic: settings.volcanic ?? [],
  uplift: settings.uplift ?? [],
};

const target = path.join(root, 'src/data/tfg/rock-layers-beneath.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  `${out._meta.rocks} rocks, ${out.layers.length} named layers -> ${path.relative(root, target)}`,
);
