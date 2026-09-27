// Tile identity: seed|profile|layer|zoom|tx|tz. See docs/ARCHITECTURE.md "Caching".
import type { LayerId, ProfileId } from '@worldgen/api/types';

export interface TileDescriptor {
  readonly layer: LayerId;
  readonly zoom: number;
  readonly tileX: number;
  readonly tileZ: number;
}

export interface TileKeyParts extends TileDescriptor {
  readonly seed: string;
  readonly profile: ProfileId;
  /** Background refinement level (`TileManager.refine`). 0 or absent keeps the plain six-part key. */
  readonly detail?: number;
}

export function tileKey(parts: TileKeyParts): string {
  const base = `${parts.seed}|${parts.profile}|${parts.layer}|${parts.zoom}|${parts.tileX}|${parts.tileZ}`;
  return parts.detail ? `${base}|d${parts.detail}` : base;
}
