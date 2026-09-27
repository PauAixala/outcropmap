"""Read-only Minecraft Anvil/NBT observation capture; no Minecraft libraries required.

Usage: python tools/read-world-biomes.py <world> <output.json>
Captures stored quart biomes (not F3's three-dimensional Voronoi lookup).
"""
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import zlib


class NBT:
    def __init__(self, data):
        self.data, self.pos = data, 0

    def take(self, n):
        value = self.data[self.pos:self.pos + n]
        if len(value) != n:
            raise ValueError('Truncated NBT')
        self.pos += n
        return value

    def number(self, fmt):
        return struct.unpack('>' + fmt, self.take(struct.calcsize(fmt)))[0]

    def string(self):
        return self.take(self.number('H')).decode('utf-8')

    def tag(self, kind):
        if 1 <= kind <= 6:
            return self.number({1: 'b', 2: 'h', 3: 'i', 4: 'q', 5: 'f', 6: 'd'}[kind])
        if kind == 7:
            return list(self.take(self.number('i')))
        if kind == 8:
            return self.string()
        if kind == 9:
            child, length = self.number('B'), self.number('i')
            return [self.tag(child) for _ in range(length)]
        if kind == 10:
            result = {}
            while True:
                child = self.number('B')
                if child == 0:
                    return result
                name = self.string()
                result[name] = self.tag(child)
        if kind in (11, 12):
            return [self.number('i' if kind == 11 else 'q') for _ in range(self.number('i'))]
        raise ValueError(f'Unsupported NBT tag {kind}')

    def root(self):
        kind = self.number('B')
        self.string()
        return self.tag(kind)


def chunk(path, cx, cz):
    with path.open('rb') as handle:
        handle.seek(4 * ((cx & 31) + (cz & 31) * 32))
        entry = handle.read(4)
        offset = int.from_bytes(entry[:3], 'big')
        if offset == 0:
            return None
        handle.seek(offset * 4096)
        size = int.from_bytes(handle.read(4), 'big')
        compression = handle.read(1)[0]
        data = handle.read(size - 1)
        if compression == 1:
            data = gzip.decompress(data)
        elif compression == 2:
            data = zlib.decompress(data)
        elif compression != 3:
            raise ValueError(f'Unsupported chunk compression {compression}')
        return NBT(data).root()


def unpack(palette, data, index, minimum=1):
    if len(palette) == 1:
        return palette[0]
    bits = max(minimum, (len(palette) - 1).bit_length())
    per_long = 64 // bits
    value = (data[index // per_long] >> ((index % per_long) * bits)) & ((1 << bits) - 1)
    return palette[value]


def capture(world, output):
    level = NBT(gzip.decompress((world / 'level.dat').read_bytes())).root()['Data']
    points, sources, missing, skipped, climate_chunks = [], {}, [], [], {}
    targets = [(0, 3700), (2600, 4400), (-300, 7300)]
    # Sparse coverage across the explored world; all exact user points are attempted first.
    for file in sorted((world / 'region').glob('r.*.*.mca')):
        _, rx, rz, _ = file.name.split('.')
        for lx, lz in [(4, 4), (12, 20), (20, 12), (28, 28)]:
            targets.append(((int(rx) * 32 + lx) * 16, (int(rz) * 32 + lz) * 16))
    for x, z in targets:
        cx, cz = x // 16, z // 16
        path = world / 'region' / f'r.{cx // 32}.{cz // 32}.mca'
        data = chunk(path, cx, cz) if path.exists() else None
        if not data:
            missing.append([x, z])
            continue
        if data['Status'] in ('minecraft:empty', 'minecraft:structure_starts', 'minecraft:structure_references'):
            skipped.append({'x': x, 'z': z, 'status': data['Status']})
            continue
        if path.name not in sources:
            sources[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
        cap = data.get('ForgeCaps', {}).get('tfc:chunk_data', {})
        if 'temperature' in cap and 'rainfall' in cap:
            climate_chunks[f'{cx},{cz}'] = {'x': cx * 16, 'z': cz * 16, 'temperature': cap['temperature'], 'rainfall': cap['rainfall']}
        sections = [s for s in data['sections'] if 'biomes' in s]
        section = next((s for s in sections if s['Y'] == 6), sections[0])
        biome = section['biomes']
        for bx, bz in [(x, z), (cx * 16 + 4, cz * 16), (cx * 16, cz * 16 + 4), (cx * 16 + 12, cz * 16 + 12)]:
            qx, qz = bx // 4, bz // 4
            index = ((qz & 3) << 2) | (qx & 3)
            points.append({'x': qx * 4, 'z': qz * 4, 'y': section['Y'] * 16,
                           'biome': unpack(biome['palette'], biome.get('data', []), index)})
    result = {'source': 'Stored Anvil quart biome palettes, read only', 'world': world.name,
              'seed': str(level['WorldGenSettings']['seed']), 'settings': level['WorldGenSettings'],
              'regionSha256': sources, 'missing': missing, 'skippedBeforeBiomes': skipped, 'points': points, 'climateChunks': list(climate_chunks.values())}
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(f'Captured {len(points)} quart biomes from {len(sources)} region files; {len(missing)} uncovered targets')


if __name__ == '__main__':
    capture(Path(sys.argv[1]), Path(sys.argv[2]))
