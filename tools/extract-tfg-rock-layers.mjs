#!/usr/bin/env node
/**
 * The overworld's rock layers, read out of a TerraFirmaGreg save's `level.dat`.
 *
 * TerraFirmaGreg generates the overworld with TerraFirmaCraft's `tfc:overworld` world preset, and
 * the game writes that preset's `rock_layer_settings` into every new world. The entries match the
 * preset in the TerraFirmaCraft jar, but the order the save holds them in is the order that decides
 * which rock wins, so the save is the source (src/worldgen/tfg/rocks.ts).
 *
 *   node tools/extract-tfg-rock-layers.mjs --level-dat "<instance>/saves/<world>/level.dat"
 *
 * Writes src/data/tfg/rock-layers.json, with a `_meta` block naming the file it read. `level.dat`
 * is gzip-compressed NBT; the reader below handles exactly the tag types NBT defines and nothing
 * else, so it needs no dependency.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { portableSource } from './lib/portable-path.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const levelDat = arg('level-dat');
const out = arg('out') ?? path.join(root, 'src/data/tfg/rock-layers.json');
if (!levelDat) {
  console.error(
    'Usage: node tools/extract-tfg-rock-layers.mjs --level-dat <save>/level.dat [--out <file>]',
  );
  process.exit(1);
}

// ------------------------------------------------------------------------------------------- NBT

/** Reads one NBT payload. Compounds become arrays of [name, value] pairs, keeping their order. */
function readNbt(buf) {
  let p = 0;
  const str = () => {
    const n = buf.readUInt16BE(p);
    p += 2;
    const s = buf.toString('utf8', p, p + n);
    p += n;
    return s;
  };
  const payload = (type) => {
    switch (type) {
      case 1:
        return buf.readInt8(p++);
      case 2: {
        const v = buf.readInt16BE(p);
        p += 2;
        return v;
      }
      case 3: {
        const v = buf.readInt32BE(p);
        p += 4;
        return v;
      }
      case 4: {
        const v = buf.readBigInt64BE(p);
        p += 8;
        return v;
      }
      case 5: {
        const v = buf.readFloatBE(p);
        p += 4;
        return v;
      }
      case 6: {
        const v = buf.readDoubleBE(p);
        p += 8;
        return v;
      }
      case 7: {
        const n = buf.readInt32BE(p);
        p += 4 + n;
        return null;
      }
      case 8:
        return str();
      case 9: {
        const t = buf.readUInt8(p++);
        const n = buf.readInt32BE(p);
        p += 4;
        const list = [];
        for (let k = 0; k < n; k++) list.push(payload(t));
        return list;
      }
      case 10: {
        const entries = [];
        for (;;) {
          const t = buf.readUInt8(p++);
          if (t === 0) return entries;
          const name = str();
          entries.push([name, payload(t)]);
        }
      }
      case 11: {
        const n = buf.readInt32BE(p);
        p += 4 + 4 * n;
        return null;
      }
      case 12: {
        const n = buf.readInt32BE(p);
        p += 4 + 8 * n;
        return null;
      }
      default:
        throw new Error(`unknown NBT tag ${type} at byte ${p}`);
    }
  };
  const type = buf.readUInt8(p++);
  str();
  return payload(type);
}

const get = (compound, key) => compound?.find?.(([k]) => k === key)?.[1];

/** The first compound entry called `name`, anywhere below `node`, with the path that leads to it. */
function findAll(node, name, trail = [], found = []) {
  if (!Array.isArray(node)) return found;
  for (const item of node) {
    if (Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') {
      if (item[0] === name) found.push([trail.concat(item[0]), item[1]]);
      findAll(item[1], name, trail.concat(item[0]), found);
    } else {
      findAll(item, name, trail, found);
    }
  }
  return found;
}

// ------------------------------------------------------------------------------------------- run

const nbt = readNbt(zlib.gunzipSync(fs.readFileSync(levelDat)));
const matches = findAll(nbt, 'rock_layer_settings').filter(([trail]) =>
  trail.includes('minecraft:overworld'),
);
if (matches.length !== 1) {
  throw new Error(
    `expected one overworld rock_layer_settings in ${levelDat}, found ${matches.length}`,
  );
}
const settings = matches[0][1];
const strip = (id) => String(id).replace(/^tfc:/, '');
const list = (key) => (get(settings, key) ?? []).map(strip);
const data = {
  _meta: {
    tool: 'tools/extract-tfg-rock-layers.mjs',
    source: portableSource(path.resolve(levelDat)),
    note: 'TerraFirmaCraft tfc:overworld world preset rock layers, in the order the save holds them.',
  },
  bottom: list('bottom'),
  land: list('land'),
  oceanFloor: list('ocean_floor'),
  volcanic: list('volcanic'),
  uplift: list('uplift'),
  layers: (get(settings, 'layers') ?? []).map((layer) => ({
    id: strip(get(layer, 'id')),
    entries: (get(layer, 'layers') ?? []).map((pair) => [
      strip(get(pair, 'key')),
      strip(get(pair, 'value')),
    ]),
  })),
};
fs.writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${path.relative(root, out)}: ${data.layers.length} layers from ${data._meta.source}`);
