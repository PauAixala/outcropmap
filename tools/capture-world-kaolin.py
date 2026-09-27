"""Read-only observation capture of existing kaolin blocks in generated Anvil chunks."""
import hashlib
import json
from pathlib import Path
import runpy
import sys

reader = runpy.run_path(str(Path(__file__).with_name('read-world-biomes.py')))
world, output = Path(sys.argv[1]), Path(sys.argv[2])
observations, hashes = [], {}
scanned = 0
for path in sorted((world / 'region').glob('r.*.*.mca')):
    _, rx, rz, _ = path.name.split('.')
    with path.open('rb') as handle:
        header = handle.read(4096)
    for index in range(1024):
        if header[index * 4:index * 4 + 3] == b'\0\0\0':
            continue
        cx, cz = int(rx) * 32 + index % 32, int(rz) * 32 + index // 32
        chunk = reader['chunk'](path, cx, cz)
        if chunk is None or chunk['Status'] not in ('minecraft:full', 'minecraft:spawn', 'minecraft:light', 'minecraft:initialize_light', 'minecraft:features'):
            continue
        scanned += 1
        found = []
        for section in chunk['sections']:
            states = section.get('block_states', {})
            palette = states.get('palette', [])
            if not any('kaolin' in p['Name'] for p in palette):
                continue
            for i in range(4096):
                block = reader['unpack'](palette, states.get('data', []), i, 4)['Name']
                if 'kaolin' in block:
                    found.append([cx * 16 + (i & 15), section['Y'] * 16 + (i >> 8), cz * 16 + ((i >> 4) & 15)])
        if found:
            hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            observations.append({'chunkX': cx, 'chunkZ': cz, 'count': len(found), 'blocks': found})
    if len(observations) >= 40:
        break
output.write_text(json.dumps({'source': 'Existing saved-world kaolin blocks; may include player changes', 'world': world.name, 'scannedGeneratedChunks': scanned, 'regionSha256': hashes, 'chunks': observations}, separators=(',', ':')) + '\n', encoding='utf-8')
print(f'Captured {sum(c["count"] for c in observations)} blocks in {len(observations)} chunks; scanned {scanned} generated chunks', flush=True)
