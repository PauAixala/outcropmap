#!/usr/bin/env node
/**
 * Each TerraFirmaCraft rock's display category — "felsic igneous intrusive", "sedimentary", and so
 * on — read out of the `Rock` enum in the TerraFirmaCraft checkout.
 *
 * `net.dries007.tfc.common.blocks.rock.Rock` declares every rock as
 * `GRANITE(RockDisplayCategory.FELSIC_IGNEOUS_INTRUSIVE, MapColor.STONE, SandBlockType.BROWN)`; the
 * first argument is the category the game's field guide groups rocks by. The rock guide
 * (`src/app/site/guide-data.ts`) shows it, so it is extracted rather than typed (AGENTS.md section 4).
 *
 *   node tools/extract-rock-categories.mjs [--tfc "$HOME/reference/tfc"] [--out <file>]
 *
 * Writes src/data/tfc-1.20/rock-categories.json, with a `_meta` block naming the file and commit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableSource } from './lib/portable-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tfc = arg('tfc') ?? path.join(os.homedir(), 'reference', 'tfc');
const out = arg('out') ?? path.join(root, 'src/data/tfc-1.20/rock-categories.json');
const source = path.join(
  tfc,
  'src/main/java/net/dries007/tfc/common/blocks/rock/Rock.java',
);
if (!fs.existsSync(source)) {
  console.error(`extract-rock-categories: ${source} not found. Pass --tfc <TerraFirmaCraft checkout>.`);
  process.exit(1);
}

const java = fs.readFileSync(source, 'utf8');
const rocks = {};
for (const m of java.matchAll(/^\s*([A-Z_]+)\(RockDisplayCategory\.([A-Z_]+)\s*,/gm)) {
  rocks[m[1].toLowerCase()] = m[2].toLowerCase();
}
if (Object.keys(rocks).length === 0) {
  console.error('extract-rock-categories: no `NAME(RockDisplayCategory.X, ...)` entries found.');
  process.exit(1);
}

let commit = null;
try {
  commit = execFileSync('git', ['-c', 'safe.directory=*', '-C', tfc, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
  }).trim();
} catch {
  commit = null;
}

const data = {
  _meta: {
    tool: 'tools/extract-rock-categories.mjs',
    source: portableSource(source),
    git_commit: commit,
    note: 'Rock -> RockDisplayCategory, the first argument of each Rock enum constant, in declaration order.',
  },
  rocks,
};
fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${Object.keys(rocks).length} rocks to ${path.relative(root, out)}`);
