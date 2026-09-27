import { categoricalColor, hashString, packRGB, unpackRGB } from './colormap';

/**
 * Ore names, in match order (the first that the id contains wins, so `tetrahedrite` is checked
 * before `copper`). Each has a theme token `--ore-<name>` in src/ui/styles/base.css: the colours
 * are theme data, not code (ADR 0005).
 */
export const ORE_TOKEN_NAMES: readonly string[] = [
  'ore-tetrahedrite',
  'ore-malachite',
  'ore-copper',
  'ore-hematite',
  'ore-magnetite',
  'ore-limonite',
  'ore-iron',
  'ore-cassiterite',
  'ore-tin',
  'ore-bismuth',
  'ore-sphalerite',
  'ore-zinc',
  'ore-galena',
  'ore-lead',
  'ore-garnierite',
  'ore-nickel',
  'ore-gold',
  'ore-silver',
  'ore-platinum',
  'ore-lignite',
  'ore-graphite',
  'ore-coal',
  'ore-sulfur',
  'ore-gypsum',
  'ore-sylvite',
  'ore-halite',
  'ore-saltpeter',
  'ore-borax',
  'ore-kaolin',
  'ore-gravel',
  'ore-lapis',
  'ore-lazurite',
  'ore-sapphire',
  'ore-ruby',
  'ore-emerald',
  'ore-diamond',
  'ore-amethyst',
  'ore-opal',
  'ore-uranium',
  'ore-chromite',
  'ore-manganese',
  'ore-tungsten',
  'ore-molybdenum',
];

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, value));
}

/**
 * Stable, ore-like marker colour; small per-id shifts keep related ores distinguishable. The base
 * colour is the resolved `--ore-<name>` token from `palette` (`ThemeTokens.colors`).
 */
export function oreMarkerColor(ore: string, palette: Readonly<Record<string, number>>): number {
  const id = ore.replace(/^[^:]+:/, '').toLowerCase();
  const token = ORE_TOKEN_NAMES.find((name) => id.includes(name.slice('ore-'.length)));
  const base = token === undefined ? undefined : palette[token];
  if (base === undefined) return categoricalColor(hashString(id));
  const rgb = unpackRGB(base);
  const hash = hashString(id);
  return packRGB(
    clampByte(rgb.r + ((hash & 15) - 7) * 2),
    clampByte(rgb.g + (((hash >>> 4) & 15) - 7) * 2),
    clampByte(rgb.b + (((hash >>> 8) & 15) - 7) * 2),
  );
}

export function matchesOreFilter(ore: string, filter: readonly string[]): boolean {
  return filter.length === 0 || filter.includes(ore.replace(/^[^:]+:/, ''));
}
