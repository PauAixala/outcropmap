#!/usr/bin/env node
/**
 * Biome tag membership for the TerraFirmaGreg profile -> `src/data/tfg/biome-tags.json`.
 *
 * Why this exists separately from `extract-datapack.mjs`: TFG's biome tags are not in the modpack
 * repository at all. They ship inside the Core mod's jar (`data/tfg/tags/worldgen/biome/earth/*.json`),
 * which `extract-datapack.mjs` cannot see because it only walks directories. Without them every vein
 * with a `biomes` restriction — 15 of TFG's 76, including bismuth, tin, lead and surface coal — is
 * dropped everywhere on the map, because a tag with no members can never match.
 *
 * The jar is read in place and never copied into the repository (AGENTS.md section 8): only the
 * extracted membership lists are written, the same kind of data as the vein tables.
 *
 * Usage:
 *   node tools/extract-tfg-biome-tags.mjs --instance "<instance>"
 *   node tools/extract-tfg-biome-tags.mjs --jar path/to/TerraFirmaGreg-Core-Modern-0.9.21.jar
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const argOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const TAG_PREFIX = 'data/tfg/tags/worldgen/biome/';

/**
 * The entries of a zip (jar) file, as { name -> Buffer }, for names passing `wanted`.
 *
 * A minimal reader rather than a dependency (ADR 0003: no runtime or build dependencies without
 * one). It reads the central directory — the only authoritative listing — then inflates each wanted
 * entry from its local header.
 */
function readZipEntries(file, wanted) {
  const buf = fs.readFileSync(file);

  // End of central directory: last occurrence of its signature, scanning back over the comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file}: not a zip archive (no end-of-central-directory record)`);

  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let entry = 0; entry < count; entry++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`${file}: central directory entry ${entry} has a bad signature`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (!wanted(name)) continue;

    // The local header repeats the name and extra fields, with its own lengths.
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${name}: bad local header signature`);
    }
    const localName = buf.readUInt16LE(localOffset + 26);
    const localExtra = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const raw = buf.subarray(start, start + compressedSize);
    out.set(name, method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
  }
  return out;
}

/** `data/tfg/tags/worldgen/biome/earth/is_mountain.json` -> `tfg:earth/is_mountain`. */
function tagIdOf(entryName) {
  return `tfg:${entryName.slice(TAG_PREFIX.length).replace(/\.json$/, '')}`;
}

/**
 * A tag's biome ids, resolving nested tag references.
 *
 * A datapack tag entry is either a biome id, `#namespace:other_tag` (include that tag's members),
 * or `{ id, required }`. Nesting is resolved here so the runtime lookup stays a plain set.
 */
function resolveMembers(tagId, tags, seen = new Set()) {
  if (seen.has(tagId)) return [];
  seen.add(tagId);
  const values = tags.get(tagId)?.values ?? [];
  const out = [];
  for (const value of values) {
    const id = typeof value === 'string' ? value : value?.id;
    if (typeof id !== 'string') continue;
    if (id.startsWith('#')) out.push(...resolveMembers(id.slice(1), tags, seen));
    else out.push(id);
  }
  return out;
}

const jarArg = argOf('--jar');
const instance = argOf('--instance');
let jar = jarArg;
if (!jar) {
  if (!instance) {
    console.error('Pass --jar <TerraFirmaGreg-Core-*.jar> or --instance <modpack instance folder>');
    process.exit(1);
  }
  const mods = path.join(instance, 'mods');
  const found = fs
    .readdirSync(mods)
    .filter((name) => /^TerraFirmaGreg-Core.*\.jar$/i.test(name))
    .sort();
  if (found.length === 0) throw new Error(`no TerraFirmaGreg-Core jar in ${mods}`);
  jar = path.join(mods, found[found.length - 1]);
}

const entries = readZipEntries(jar, (name) => name.startsWith(TAG_PREFIX) && name.endsWith('.json'));
if (entries.size === 0) throw new Error(`${jar} holds no ${TAG_PREFIX}*.json`);

const parsed = new Map();
for (const [name, contents] of entries) {
  parsed.set(tagIdOf(name), JSON.parse(contents.toString('utf8')));
}

const tags = {};
for (const tagId of [...parsed.keys()].sort()) {
  const members = [...new Set(resolveMembers(tagId, parsed))].sort();
  if (members.length > 0) tags[tagId] = members;
}

const output = {
  _meta: {
    extraction_date: new Date().toISOString(),
    source: 'tools/extract-tfg-biome-tags.mjs',
    source_jar: path.basename(jar),
    tag_count: Object.keys(tags).length,
  },
  tags,
};

const out = path.join(process.cwd(), 'src', 'data', 'tfg', 'biome-tags.json');
fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${Object.keys(tags).length} biome tags from ${path.basename(jar)} to ${out}`);
for (const [tag, members] of Object.entries(tags)) console.log(`  ${tag}: ${members.length}`);
