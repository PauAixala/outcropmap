"""Read-only: list every structure start stored in one dimension of a Minecraft world.

Usage: python tools/read-world-structures.py <world dir> <out.json> [dim folder]
The dimension folder defaults to the overworld's ".". The Nether is "DIM-1"; a modded dimension is
"dimensions/<namespace>/<path>".
Never writes to the world. Output: seed, and one entry per structure start with its id, the
chunk it starts in, and its bounding box.
"""
import gzip
import json
import struct
import sys
import zlib
from pathlib import Path


class NBT:
    def __init__(self, data):
        self.d, self.p = data, 0

    def take(self, n):
        v = self.d[self.p:self.p + n]
        self.p += n
        return v

    def num(self, fmt):
        return struct.unpack('>' + fmt, self.take(struct.calcsize(fmt)))[0]

    def string(self):
        return self.take(self.num('H')).decode('utf-8', 'replace')

    def payload(self, kind):
        if kind == 1: return self.num('b')
        if kind == 2: return self.num('h')
        if kind == 3: return self.num('i')
        if kind == 4: return self.num('q')
        if kind == 5: return self.num('f')
        if kind == 6: return self.num('d')
        if kind == 7: return self.take(self.num('i'))
        if kind == 8: return self.string()
        if kind == 9:
            inner, n = self.num('b'), self.num('i')
            return [self.payload(inner) for _ in range(n)]
        if kind == 10:
            out = {}
            while True:
                k = self.num('b')
                if k == 0:
                    return out
                name = self.string()
                out[name] = self.payload(k)
        if kind == 11:
            n = self.num('i')
            return list(struct.unpack('>%di' % n, self.take(4 * n)))
        if kind == 12:
            n = self.num('i')
            return list(struct.unpack('>%dq' % n, self.take(8 * n)))
        raise ValueError('bad tag %d' % kind)

    def root(self):
        kind = self.num('b')
        self.string()
        return self.payload(kind)


def chunks(region: Path):
    data = region.read_bytes()
    if len(data) < 8192:
        return
    for i in range(1024):
        off = struct.unpack('>I', b'\0' + data[i * 4:i * 4 + 3])[0] * 4096
        if off == 0:
            continue
        length = struct.unpack('>I', data[off:off + 4])[0]
        comp = data[off + 4]
        raw = data[off + 5:off + 4 + length]
        if comp == 2:
            raw = zlib.decompress(raw)
        elif comp == 1:
            raw = gzip.decompress(raw)
        elif comp != 3:
            continue
        yield NBT(raw).root()


def main():
    world, out = Path(sys.argv[1]), Path(sys.argv[2])
    dim_folder = sys.argv[3] if len(sys.argv) > 3 else '.'
    level = NBT(gzip.decompress((world / 'level.dat').read_bytes())).root()
    data = level.get('Data', {})
    seed = data.get('WorldGenSettings', {}).get('seed')
    starts = []
    generated_chunks = 0
    # Per region, a 1024-bit map of fully generated chunks (256 hex digits, bit i = chunk index
    # i = localX + 32 * localZ), so a checker can tell "no structure here" from "never generated".
    coverage = {}
    for region in sorted((world / dim_folder / 'region').glob('r.*.mca')):
        bits = 0
        for chunk in chunks(region):
            status = chunk.get('Status', '')
            if status in ('minecraft:full', 'full'):
                generated_chunks += 1
                cx, cz = chunk.get('xPos'), chunk.get('zPos')
                bits |= 1 << ((cx & 31) + 32 * (cz & 31))
            s = chunk.get('structures', {}).get('starts', {})
            for sid, start in s.items():
                if start.get('id') == 'INVALID':
                    continue
                children = start.get('Children', [])
                boxes = [c.get('BB') for c in children if c.get('BB')]
                bb = None
                if boxes:
                    bb = [min(b[0] for b in boxes), min(b[1] for b in boxes), min(b[2] for b in boxes),
                          max(b[3] for b in boxes), max(b[4] for b in boxes), max(b[5] for b in boxes)]
                starts.append({
                    'structure': sid,
                    'chunkX': start.get('ChunkX', chunk.get('xPos')),
                    'chunkZ': start.get('ChunkZ', chunk.get('zPos')),
                    'pieces': len(children),
                    'bb': bb,
                    # The start piece is the first child; its box centre is where the game checks
                    # the biome for a jigsaw structure.
                    'startBB': children[0].get('BB') if children else None,
                })
        if bits:
            coverage[region.stem[2:]] = format(bits, '0256x')
    result = {'seed': str(seed), 'fullChunks': generated_chunks, 'starts': starts, 'coverage': coverage}
    out.write_text(json.dumps(result, indent=1))
    counts = {}
    for s in starts:
        counts[s['structure']] = counts.get(s['structure'], 0) + 1
    print('seed', seed, 'full chunks', generated_chunks, 'starts', len(starts))
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f'{v:5d}  {k}')


main()
