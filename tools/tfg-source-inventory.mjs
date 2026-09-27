/**
 * Inventory the installed TFG/TFC artifacts without copying or modifying the instance.
 * Usage: node tools/tfg-source-inventory.mjs <instance-root>   (or set OUTCROP_INSTANCE)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveInstance } from './lib/portable-path.mjs';

const instance = resolve(resolveInstance(process.argv[2], { tool: 'tfg-source-inventory' }));
const mods = join(instance, 'mods');
const names = {
  tfg: 'TerraFirmaGreg-Core-Modern-0.9.21.jar',
  tfc: 'TerraFirmaCraft-Forge-1.20.1-3.2.24.jar',
  worldVersions: 'saves/New World/data/tfg_worldgen_versions.dat',
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const fileInfo = (file) => ({ path: file, bytes: statSync(file).size, sha256: sha256(file) });
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8',
  timeout: options.timeout ?? 15_000,
  windowsHide: true,
});

const tfgJar = join(mods, names.tfg);
const tfcJar = join(mods, names.tfc);
const javap = run('javap', ['-classpath', tfgJar, '-p', 'su.terrafirmagreg.core.world.new_ow_wg.biome.TFGBiomes']);
const biomes = [...javap.matchAll(/BiomeExtension (\w+);/g)].map((m) => m[1].toLowerCase());
const taskJavap = run('javap', ['-classpath', tfgJar, '-p', '-c', 'su.terrafirmagreg.core.world.new_ow_wg.region.TFGRegionTask']);
const valuesMethod = taskJavap.split('private static su.terrafirmagreg.core.world.new_ow_wg.region.TFGRegionTask[] $values();')[1]?.split('static {};')[0] ?? '';
const taskOrder = [...valuesMethod.matchAll(/\/\/ Field ([A-Z_]+):/g)].map((m) => m[1]);
const entries = run('jar', ['tf', tfgJar]).split(/\r?\n/).filter(Boolean);
const mixins = entries.filter((entry) => entry.includes('new_ow_wg') && entry.endsWith('.class')).map((entry) => entry.replaceAll('/', '.').replace(/\.class$/, ''));
const biomeResources = entries.filter((entry) => entry.startsWith('assets/tfc/tfcgenviewer/biomes/') && entry.endsWith('.json')).map((entry) => entry.split('/').at(-1).replace(/\.json$/, ''));

assert.equal(biomes.length, 109, 'unexpected TFG biome constant count');
assert.equal(biomeResources.length, biomes.length, 'biome constants/resources count mismatch');
assert.equal(taskOrder.length, 16, 'unexpected TFG regional task count');
assert.deepEqual(taskOrder.slice(0, 3), ['INIT', 'ADD_CONTINENTS', 'ANNOTATE_DISTANCE_TO_CELL_EDGE']);

let sourceStatus = 'not checked';
let sourceCommit = null;
try {
  const remote = run('git', ['ls-remote', '--exit-code', '--refs', 'https://github.com/TerraFirmaGreg-Team/Core-Modern.git', 'refs/tags/0.9.21']);
  sourceCommit = remote.trim().split(/\s+/)[0] ?? null;
  assert.match(sourceCommit ?? '', /^[0-9a-f]{40}$/);
  sourceStatus = 'git ls-remote succeeded';
} catch (error) {
  sourceStatus = `git ls-remote failed: ${error.shortMessage ?? error.message}`;
}

const output = {
  instance,
  artifacts: { tfg: fileInfo(tfgJar), tfc: fileInfo(tfcJar), worldVersions: fileInfo(join(instance, names.worldVersions)) },
  installedVersions: { minecraft: '1.20.1', tfgCoreModern: '0.9.21', tfcForge: '3.2.24' },
  tfgBiomeConstants: biomes,
  tfgBiomeConstantCount: biomes.length,
  tfgRegionTaskValues: taskOrder,
  relevantClassCount: mixins.length,
  relevantClasses: mixins,
  bundledViewerBiomeResourceCount: biomeResources.length,
  bundledViewerBiomeResources: biomeResources,
  sourceRepository: { url: 'https://github.com/TerraFirmaGreg-Team/Core-Modern', requestedTag: '0.9.21', resolvedCommit: sourceCommit, status: sourceStatus },
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
