/**
 * Human names for ores and veins — never a resource id on screen (docs/PLAN.md 10c).
 *
 * `en.oreNames` is a curated map, but it cannot cover TerraFirmaGreg: that profile has 76 veins and
 * roughly 150 distinct materials, and hand-transcribing them would both rot on the next extraction
 * and break AGENTS.md section 4's "data, not code" rule. So this consults the curated map first and
 * otherwise formats the id, which is already structured enough to read.
 *
 * TFG vein ids are `<depth>_<material>` — `deep_galena`, `surface_gold`, `high_lead`. The depth is
 * real information a player wants (a surface vein is walkable, a deep one is a mining trip), so it
 * is kept as a qualifier rather than thrown away.
 */
import { en } from './en';

/** Depth qualifiers TFG prefixes onto its vein names. */
const DEPTH_QUALIFIERS: Readonly<Record<string, string>> = {
  surface: 'surface',
  normal: '',
  high: 'high',
  deep: 'deep',
};

function titleCase(id: string): string {
  return id
    .split('_')
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Strips the `tfc:` / `tfg:` namespace from an ore or vein id. */
export function stripOreNamespace(id: string): string {
  return id.replace(/^(tfc|tfg):/, '');
}

/**
 * A readable name for a biome id.
 *
 * `en.biomeNames` is hand-checked and covers the overworld. The other dimensions add 108 biomes
 * whose ids already read as names once the namespace and the dimension folder come off —
 * `tfg:nether/muggy_bog` is "Muggy Bog" — so those are derived rather than transcribed, and a
 * curated entry still wins wherever one exists.
 */
export function formatBiomeName(id: string): string {
  const curated = en.biomeNames[id];
  if (curated !== undefined) return curated;
  const bare = id.slice(id.lastIndexOf('/') + 1).replace(/^[^:]+:/, '');
  return titleCase(bare);
}

/**
 * A readable name for one material id (`silver`, `native_gold`, `bituminous_coal`).
 * Used for the "yields" list, where the depth qualifier does not apply.
 */
export function formatMaterialName(id: string): string {
  const bare = stripOreNamespace(id);
  return en.oreNames[bare] ?? titleCase(bare);
}

/**
 * A readable name for a vein id, keeping its depth as a qualifier:
 * `tfg:deep_galena` -> "Galena (deep)", `tfg:normal_copper` -> "Copper", `tfc:diamond` -> "Diamond".
 */
export function formatOreName(id: string): string {
  const bare = stripOreNamespace(id);

  // A curated name for the whole id always wins — TFC's names are hand-checked.
  const curated = en.oreNames[bare];
  if (curated !== undefined) return curated;

  const underscore = bare.indexOf('_');
  if (underscore > 0) {
    const head = bare.slice(0, underscore);
    const qualifier = DEPTH_QUALIFIERS[head];
    if (qualifier !== undefined) {
      const rest = bare.slice(underscore + 1);
      const name = en.oreNames[rest] ?? titleCase(rest);
      return qualifier === '' ? name : `${name} (${qualifier})`;
    }
  }
  return titleCase(bare);
}
