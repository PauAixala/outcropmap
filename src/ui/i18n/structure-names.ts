/**
 * A readable name for a structure id, for the map's readout and the structures guide. No imports,
 * so the build-time guide writer can use it (it is loaded through vite.config.ts).
 */

/** `tfc_ruined_world:small_limestone_church_2` -> "Small limestone church 2". */
export function structureVariantName(id: string): string {
  const path = id.slice(id.indexOf(':') + 1);
  const words = path.slice(path.lastIndexOf('/') + 1).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
