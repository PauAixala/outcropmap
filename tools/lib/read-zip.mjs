/**
 * A zip central-directory reader.
 *
 * Lives here because more than one tool needs it and because the naive alternative — piping
 * `unzip -p` and splitting the output on `}{` — silently cut inside JSON arrays and read 1 920 of
 * 20 841 recipes without saying so.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

export function readZip(file, wanted) {
  const buf = fs.readFileSync(file);
  // End of central directory: scan back for its signature, past any trailing comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    // The local header repeats the name and extra with its own lengths.
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLen + localExtraLen;
    const slice = buf.subarray(dataAt, dataAt + compressed);
    try {
      out.push([name, method === 0 ? slice.toString('utf8') : zlib.inflateRawSync(slice).toString('utf8')]);
    } catch {
      // A single unreadable entry is not worth losing the jar over.
    }
  }
  return out;
}
