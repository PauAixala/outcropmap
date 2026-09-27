"""Read-only: count the ore blocks a real Minecraft world actually contains around a point.

The map predicts where a vein is; only the save can say whether the game put ore there. A prospector
pick cannot settle it — it scans a cone in the direction you face, so "no ores found" is not the same
as "no ore present".

Usage: python tools/read-world-ores.py <world dir> <x> <z> <radius> [minY maxY]
Never writes to the world.
"""
import gzip
import json
import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

GOLD_AT = []


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


def chunk_at(region_file: Path, cx: int, cz: int):
    """One chunk's NBT out of a region file, or None if it was never written."""
    data = region_file.read_bytes()
    if len(data) < 8192:
        return None
    i = (cx & 31) + 32 * (cz & 31)
    off = struct.unpack('>I', b'\0' + data[i * 4:i * 4 + 3])[0] * 4096
    if off == 0:
        return None
    length = struct.unpack('>I', data[off:off + 4])[0]
    comp = data[off + 4]
    raw = data[off + 5:off + 4 + length]
    if comp == 2:
        raw = zlib.decompress(raw)
    elif comp == 1:
        raw = gzip.decompress(raw)
    elif comp != 3:
        return None
    return NBT(raw).root()


def section_blocks(section):
    """(palette, index accessor) for one 16x16x16 section, or None when it is all one block."""
    states = section.get('block_states') or {}
    palette = [entry.get('Name', '?') for entry in states.get('palette', [])]
    if not palette:
        return None, None
    data = states.get('data')
    if data is None:
        return palette, (lambda _i: 0)
    bits = max(4, (len(palette) - 1).bit_length())
    per_long = 64 // bits
    mask = (1 << bits) - 1

    def index(i):
        # 1.16+ packing: indices never straddle two longs.
        word = data[i // per_long]
        shift = (i % per_long) * bits
        return (word >> shift) & mask

    return palette, index


def main():
    world = Path(sys.argv[1])
    cx_block, cz_block, radius = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
    min_y = int(sys.argv[5]) if len(sys.argv) > 5 else -64
    max_y = int(sys.argv[6]) if len(sys.argv) > 6 else 320

    counts = Counter()
    GOLD_AT.clear()
    y_of_interest = Counter()
    scanned = 0
    missing = 0
    for cx in range((cx_block - radius) >> 4, ((cx_block + radius) >> 4) + 1):
        for cz in range((cz_block - radius) >> 4, ((cz_block + radius) >> 4) + 1):
            region = world / 'region' / f'r.{cx >> 5}.{cz >> 5}.mca'
            if not region.exists():
                missing += 1
                continue
            chunk = chunk_at(region, cx, cz)
            if chunk is None or chunk.get('Status', '') not in ('minecraft:full', 'full'):
                missing += 1
                continue
            scanned += 1
            for section in chunk.get('sections', []):
                base_y = section.get('Y', 0) * 16
                if base_y + 15 < min_y or base_y > max_y:
                    continue
                palette, index = section_blocks(section)
                if palette is None:
                    continue
                interesting = {
                    i: name for i, name in enumerate(palette)
                    if '_ore' in name or 'raw_' in name
                }
                if not interesting:
                    continue
                for i in range(4096):
                    y = base_y + (i >> 8)
                    if y < min_y or y > max_y:
                        continue
                    name = interesting.get(index(i))
                    if name is None:
                        continue
                    x = cx * 16 + (i & 15)
                    z = cz * 16 + ((i >> 4) & 15)
                    if abs(x - cx_block) > radius or abs(z - cz_block) > radius:
                        continue
                    counts[name] += 1
                    if 'gold' in name:
                        y_of_interest[y] += 1
                        if len(GOLD_AT) < 64:
                            GOLD_AT.append((x, y, z))

    print(f'scanned {scanned} chunks around {cx_block},{cz_block} (radius {radius}, y {min_y}..{max_y})'
          f'{f", {missing} not generated" if missing else ""}')
    gold = {name: n for name, n in counts.items() if 'gold' in name}
    if gold:
        print('gold-bearing blocks: ' + ', '.join(f'{name} x{n}' for name, n in sorted(gold.items())))
        print('first gold positions: ' + ', '.join(f'{x},{y},{z}' for x, y, z in GOLD_AT[:6]))
    for name, n in counts.most_common(20):
        print(f'  {n:6d}  {name}')
    if y_of_interest:
        print('gold blocks per Y: ' + ' '.join(f'{y}:{n}' for y, n in sorted(y_of_interest.items())))
    elif counts:
        print('no gold-bearing block in that box')


if __name__ == '__main__':
    main()
