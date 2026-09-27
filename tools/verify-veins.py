"""Check the map's vein markers against a real Minecraft save, and write the score as JSON.

Read-only. Pairs with `tools/dump-vein-predictions.ts`:

    npx vite-node tools/dump-vein-predictions.ts out/pred-a.json tfg -6696614430994881185 -3328 2816 700
    python tools/verify-veins.py "<world dir>" out/pred-a.json out/score-a.json

Two rules keep the number honest, both learned the hard way:

  * a marker whose ground was never generated is **unverifiable**, not wrong. Counting those as
    misses turned a 92% into a 79% the first time this ran;
  * the search box follows the vein's own reach, because a metaball body sits off-centre from the
    marker. Strict and loose tolerances are both reported, so the figure cannot hide behind one
    magic constant.

Merge several runs with `--merge score-a.json score-b.json ... out.json` to get the per-vein table
the app ships in `src/data/<profile>/vein-verification.json`.
"""
import importlib.util
import json
import sys
from collections import defaultdict
from pathlib import Path

STRICT_XZ, STRICT_Y = 8, 8
# Depth buckets, in blocks below the surface. Negative means the band's centre is in the air.
DEPTH_EDGES = (0, 16, 32, 48, 64)


def depth_bucket(depth: int) -> int:
    """The lower edge of the bucket a depth falls in; -16 for anything above the ground."""
    if depth < 0:
        return -16
    for edge in reversed(DEPTH_EDGES):
        if depth >= edge:
            return edge
    return 0
LOOSE_XZ, LOOSE_Y = 16, 12
HERE = Path(__file__).resolve().parent


def load_reader():
    spec = importlib.util.spec_from_file_location('ores', str(HERE / 'read-world-ores.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def score(world: Path, predictions_path: Path, out_path: Path, dim_folder: str = '.') -> None:
    ores = load_reader()
    payload = json.loads(predictions_path.read_text(encoding='utf-8'))
    box, deposits = payload['box'], payload['deposits']

    by_block = defaultdict(list)
    for i, d in enumerate(deposits):
        for name in d['blocks']:
            by_block[name].append(i)

    generated = set()
    hit_strict = [False] * len(deposits)
    hit_loose = [False] * len(deposits)
    # How far a player standing on the marker would have to walk to the nearest block of that ore.
    # This is the number the marker is *for*, and it moves when the marker moves.
    nearest = [None] * len(deposits)

    for cx in range(box['minX'] >> 4, (box['maxX'] >> 4) + 1):
        for cz in range(box['minZ'] >> 4, (box['maxZ'] >> 4) + 1):
            region = world / dim_folder / 'region' / f'r.{cx >> 5}.{cz >> 5}.mca'
            if not region.exists():
                continue
            chunk = ores.chunk_at(region, cx, cz)
            if chunk is None or chunk.get('Status', '') not in ('minecraft:full', 'full'):
                continue
            generated.add((cx, cz))
            for section in chunk.get('sections', []):
                base_y = section.get('Y', 0) * 16
                palette, index = ores.section_blocks(section)
                if palette is None:
                    continue
                wanted = {i: name for i, name in enumerate(palette) if name in by_block}
                if not wanted:
                    continue
                for i in range(4096):
                    name = wanted.get(index(i))
                    if name is None:
                        continue
                    y = base_y + (i >> 8)
                    x = cx * 16 + (i & 15)
                    z = cz * 16 + ((i >> 4) & 15)
                    for di in by_block[name]:
                        d = deposits[di]
                        dx, dz = abs(x - d['x']), abs(z - d['z'])
                        # How far to walk before sinking a shaft through the band we advertise.
                        if (dx <= d['radius'] + LOOSE_XZ and dz <= d['radius'] + LOOSE_XZ
                                and d['y0'] <= y <= d['y1']):
                            walk = (dx * dx + dz * dz) ** 0.5
                            if nearest[di] is None or walk < nearest[di]:
                                nearest[di] = walk
                        if hit_strict[di]:
                            continue
                        if (
                            dx <= d['radius'] + STRICT_XZ
                            and dz <= d['radius'] + STRICT_XZ
                            and d['y0'] - STRICT_Y <= y <= d['y1'] + STRICT_Y
                        ):
                            hit_strict[di] = True
                            hit_loose[di] = True
                        elif (
                            not hit_loose[di]
                            and dx <= d['radius'] + LOOSE_XZ
                            and dz <= d['radius'] + LOOSE_XZ
                            and d['y0'] - LOOSE_Y <= y <= d['y1'] + LOOSE_Y
                        ):
                            hit_loose[di] = True

    def verifiable(d):
        """The marker's own chunk and the chunks its body reaches into must all exist."""
        for dx in (-d['radius'], 0, d['radius']):
            for dz in (-d['radius'], 0, d['radius']):
                if ((d['x'] + dx) >> 4, (d['z'] + dz) >> 4) not in generated:
                    return False
        return True

    per_vein = defaultdict(lambda: {'checked': 0, 'real': 0})
    # How well a marker holds up by how deep it is. Measured on Pau's world, this is by far the
    # strongest signal we have: a band centred 64 blocks down is real essentially always, one whose
    # centre is above the ground almost never. DEPTH_BUCKET is in blocks.
    per_depth = defaultdict(lambda: {'checked': 0, 'real': 0})
    unverifiable = 0
    for d, ok in zip(deposits, hit_loose):
        if not verifiable(d):
            unverifiable += 1
            continue
        entry = per_vein[d['id']]
        entry['checked'] += 1
        entry['real'] += 1 if ok else 0
        depth = d.get('depth')
        if depth is not None:
            entry = per_depth[str(depth_bucket(depth))]
            entry['checked'] += 1
            entry['real'] += 1 if ok else 0

    checked = sum(v['checked'] for v in per_vein.values())
    real = sum(v['real'] for v in per_vein.values())
    # Markers with no ore in reach at all count as a miss, not as a missing sample.
    walks = sorted(
        (nearest[di] if nearest[di] is not None else float('inf'))
        for di in range(len(deposits))
        if verifiable(deposits[di])
    )
    walks = [w for w in walks if w != float('inf')] or []
    unreachable = sum(
        1 for di in range(len(deposits)) if verifiable(deposits[di]) and nearest[di] is None
    )
    walk_stats = {
        'median': round(walks[len(walks) // 2], 1),
        'p90': round(walks[int(len(walks) * 0.9)], 1),
        'mean': round(sum(walks) / len(walks), 1),
    } if walks else None
    result = {
        'profile': payload.get('profile'),
        'seed': payload.get('seed'),
        'box': box,
        'markers': len(deposits),
        'unverifiable': unverifiable,
        'checked': checked,
        'real': real,
        'walk_to_ore': walk_stats,
        'no_ore_in_reach': unreachable,
        'veins': dict(sorted(per_vein.items())),
        'depth': dict(sorted(per_depth.items(), key=lambda kv: int(kv[0]))),
    }
    out_path.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    if walk_stats:
        print(f'shaft at the marker, through the band we advertise: median {walk_stats["median"]}, '
              f'mean {walk_stats["mean"]}, p90 {walk_stats["p90"]} blocks to the nearest ore '
              f'({unreachable} markers with none in reach)')
    print(f'{checked} verifiable markers, {real} backed by real ore '
          f'({100 * real / max(checked, 1):.1f}%), {unverifiable} in ungenerated ground')
    print(f'wrote {out_path}')


def merge(paths, out_path: Path) -> None:
    per_vein = defaultdict(lambda: {'checked': 0, 'real': 0})
    per_depth = defaultdict(lambda: {'checked': 0, 'real': 0})
    boxes = []
    profile = seed = None
    for path in paths:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        profile = profile or data.get('profile')
        seed = seed or data.get('seed')
        boxes.append(data['box'])
        for vein, counts in data['veins'].items():
            per_vein[vein]['checked'] += counts['checked']
            per_vein[vein]['real'] += counts['real']
        for depth, counts in (data.get('depth') or {}).items():
            per_depth[depth]['checked'] += counts['checked']
            per_depth[depth]['real'] += counts['real']

    checked = sum(v['checked'] for v in per_vein.values())
    real = sum(v['real'] for v in per_vein.values())
    out = {
        '_meta': {
            'source': 'tools/verify-veins.py, against a real TerraFirmaGreg save',
            'profile': profile,
            'seed': seed,
            'boxes': boxes,
            'checked': checked,
            'real': real,
        },
        'veins': {
            vein: {**counts, 'precision': round(counts['real'] / counts['checked'], 3)}
            for vein, counts in sorted(per_vein.items())
            if counts['checked'] > 0
        },
        'depth': {
            depth: {**counts, 'precision': round(counts['real'] / counts['checked'], 3)}
            for depth, counts in sorted(per_depth.items(), key=lambda kv: int(kv[0]))
            if counts['checked'] > 0
        },
    }
    out_path.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(f'merged {len(paths)} runs: {real}/{checked} = {100 * real / max(checked, 1):.1f}%')
    print(f'wrote {out_path}')


if __name__ == '__main__':
    if sys.argv[1] == '--merge':
        merge(sys.argv[2:-1], Path(sys.argv[-1]))
    else:
        # The Nether and the planets live in their own folder under the save.
        dim_folder = sys.argv[4] if len(sys.argv) > 4 else '.'
        score(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), dim_folder)
