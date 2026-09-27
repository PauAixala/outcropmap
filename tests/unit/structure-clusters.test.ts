import { describe, expect, it } from 'vitest';
import { clusterStructures } from '../../src/render/structure-clusters';
import type { StructureFeature } from '../../src/worldgen/api/types';

const at = (set: string, x: number, z: number): StructureFeature => ({ id: `${set}@${x},${z}`, type: set, x, z });
// One block per pixel, origin at the top left: easy to reason about distances.
const identity = (x: number, z: number) => ({ x, y: z });

describe('clusterStructures', () => {
  it('merges markers that would overlap and keeps distant ones apart', () => {
    const clusters = clusterStructures([at('a', 0, 0), at('a', 10, 5), at('b', 100, 100)], identity, 22);
    expect(clusters.map((c) => c.members.length).sort()).toEqual([1, 2]);
  });

  it('puts the cluster at its members centroid, and names it after the most common set', () => {
    const clusters = clusterStructures([at('a', 0, 0), at('b', 4, 0), at('b', 8, 0)], identity, 22);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.x).toBe(4);
    expect(clusters[0]!.setId).toBe('b');
  });

  it('groups the same way after a pan, since a pan moves every marker equally', () => {
    const markers = [at('a', 0, 0), at('a', 20, 0), at('a', 40, 0), at('a', 300, 7)];
    const shape = (offset: number) =>
      clusterStructures(markers, (x, z) => ({ x: x + offset, y: z + offset }), 22)
        .map((c) => c.members.map((m) => m.id).join('|'))
        .sort();
    expect(shape(0)).toEqual(shape(137));
  });

  it('leaves a lone marker as a one-member cluster', () => {
    expect(clusterStructures([at('a', 5, 5)], identity, 22)[0]!.members).toHaveLength(1);
  });
});
