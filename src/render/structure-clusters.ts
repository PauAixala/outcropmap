/**
 * Groups structure markers that would overlap on screen, so a zoomed-out view reads as a few
 * counted markers instead of a pile. Shared by the painter and the click hit-test, so what you click
 * is exactly what was drawn.
 *
 * Greedy, in world order: each marker joins the first cluster whose anchor is within `radiusPx`,
 * or starts one. World order (not screen order) keeps the grouping stable while panning, since a pan
 * moves every marker by the same screen offset. A spatial grid keeps it linear in the marker count.
 */
import type { StructureFeature } from '@worldgen/api/types';

export interface StructureCluster {
  readonly members: readonly StructureFeature[];
  /** Screen position the cluster is drawn at: its first member's. */
  readonly screenX: number;
  readonly screenY: number;
  /** Block-space centroid of the members, where a click zooms to. */
  readonly x: number;
  readonly z: number;
  /** The structure set most members belong to (ties: the first seen), for the cluster's icon. */
  readonly setId: string;
}

const setIdOf = (id: string): string => {
  const at = id.indexOf('@');
  return at < 0 ? id : id.slice(0, at);
};

export function clusterStructures(
  structures: readonly StructureFeature[],
  toScreen: (x: number, z: number) => { readonly x: number; readonly y: number },
  radiusPx: number,
): StructureCluster[] {
  const ordered = [...structures].sort((a, b) => a.x - b.x || a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const building: { screenX: number; screenY: number; members: StructureFeature[] }[] = [];
  const grid = new Map<string, number[]>();
  const radiusSq = radiusPx * radiusPx;

  for (const structure of ordered) {
    const screen = toScreen(structure.x, structure.z);
    const cellX = Math.floor(screen.x / radiusPx);
    const cellY = Math.floor(screen.y / radiusPx);
    let joined = -1;
    for (let dy = -1; dy <= 1 && joined < 0; dy++) {
      for (let dx = -1; dx <= 1 && joined < 0; dx++) {
        for (const index of grid.get(`${cellX + dx},${cellY + dy}`) ?? []) {
          const cluster = building[index]!;
          const ddx = cluster.screenX - screen.x;
          const ddy = cluster.screenY - screen.y;
          if (ddx * ddx + ddy * ddy <= radiusSq) {
            joined = index;
            break;
          }
        }
      }
    }
    if (joined >= 0) {
      building[joined]!.members.push(structure);
      continue;
    }
    const key = `${cellX},${cellY}`;
    const list = grid.get(key) ?? [];
    list.push(building.length);
    grid.set(key, list);
    building.push({ screenX: screen.x, screenY: screen.y, members: [structure] });
  }

  return building.map(({ screenX, screenY, members }) => {
    const counts = new Map<string, number>();
    let setId = setIdOf(members[0]!.id);
    let best = 0;
    for (const member of members) {
      const id = setIdOf(member.id);
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      if (count > best) {
        best = count;
        setId = id;
      }
    }
    const x = members.reduce((sum, m) => sum + m.x, 0) / members.length;
    const z = members.reduce((sum, m) => sum + m.z, 0) / members.length;
    return { members, screenX, screenY, x, z, setId };
  });
}
