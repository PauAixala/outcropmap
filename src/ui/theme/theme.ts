/**
 * Three-state theme: 'system' | 'light' | 'dark' (ADR 0005).
 * Sets data-theme on <html>, persists the choice, and exposes resolved colour tokens so canvas
 * renderers and workers can paint with the same palette as the DOM.
 */
import { createStorage } from '@platform/storage';
import type { StorageAdapter } from '@platform/storage';
import { ORE_TOKEN_NAMES } from '@render/markers';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface ThemeTokens {
  /** Token name (without the leading --) to a packed 0xRRGGBB value. */
  readonly colors: Record<string, number>;
  /**
   * Token name to its alpha, 0..1, for tokens that declare one (`#rrggbbaa`, `rgba()`). `colors`
   * cannot carry it, so without this the grid tokens' translucency was silently dropped and the
   * grid painted as solid white or black.
   */
  readonly alphas?: Record<string, number>;
}

export const THEME_STORAGE_KEY = 'theme';

/** Every colour token declared in src/ui/styles/base.css. Keep this list in sync with that file. */
const TOKEN_NAMES = [
  'bg',
  'bg-panel',
  'bg-elevated',
  'bg-sunk',
  'bevel-hi',
  'bevel-lo',
  'border',
  'text',
  'text-muted',
  'accent',
  'accent-contrast',
  'accent-soft',
  'value',
  'map-bg',
  'map-grid',
  'map-grid-strong',
  'map-label',
  'map-label-plate',
  'marker-outline',
  'marker-mineral',
  'wp-red',
  'wp-orange',
  'wp-green',
  'wp-blue',
  'wp-purple',
  'wp-pink',
  // The map's ore marker colours: read here so the canvas gets them resolved.
  ...ORE_TOKEN_NAMES,
];

export type ThemeChangeListener = (tokens: ThemeTokens, preference: ThemePreference) => void;

let storage: StorageAdapter | null = null;
function getStorage(): StorageAdapter {
  storage ??= createStorage();
  return storage;
}

let currentPreference: ThemePreference = 'system';
let currentTokens: ThemeTokens = { colors: {} };
let mediaQuery: MediaQueryList | null = null;
const listeners = new Set<ThemeChangeListener>();

/** Parses a CSS colour string (hex, incl. 3/4/6/8-digit, or rgb()/rgba()) into packed 0xRRGGBB. */
/** Alpha of a CSS colour string, 0..1: a `#rgba`/`#rrggbbaa` alpha digit, or rgba()'s 4th part. */
export function parseAlpha(value: string): number {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 4) return Number.parseInt(hex.charAt(3).repeat(2), 16) / 255;
    if (hex.length === 8) return Number.parseInt(hex.slice(6, 8), 16) / 255;
    return 1;
  }
  if (trimmed.startsWith('rgb')) {
    const parts = trimmed.replace(/^rgba?\(|\)$/g, '').split(/[\s,/]+/).filter(Boolean);
    const raw = parts[3];
    if (raw === undefined) return 1;
    const alpha = raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    return Number.isFinite(alpha) ? alpha : 1;
  }
  return 1;
}

function parseColor(value: string): number {
  const trimmed = value.trim();
  if (trimmed.startsWith('#')) {
    let hex = trimmed.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    const r = Number.parseInt(hex.slice(0, 2), 16) || 0;
    const g = Number.parseInt(hex.slice(2, 4), 16) || 0;
    const b = Number.parseInt(hex.slice(4, 6), 16) || 0;
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  }
  const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(trimmed);
  if (match) {
    const r = Math.round(Number(match[1] ?? 0));
    const g = Math.round(Number(match[2] ?? 0));
    const b = Math.round(Number(match[3] ?? 0));
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  }
  return 0;
}

/** Reads the live CSS custom properties off <html> and packs them into a ThemeTokens object. */
export function resolveThemeTokens(): ThemeTokens {
  const styles = getComputedStyle(document.documentElement);
  const colors: Record<string, number> = {};
  const alphas: Record<string, number> = {};
  for (const name of TOKEN_NAMES) {
    const raw = styles.getPropertyValue(`--${name}`);
    if (!raw) continue;
    colors[name] = parseColor(raw);
    const alpha = parseAlpha(raw);
    if (alpha < 1) alphas[name] = alpha;
  }
  return { colors, alphas };
}

function applyDomAttribute(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

function notify(): void {
  currentTokens = resolveThemeTokens();
  for (const listener of listeners) listener(currentTokens, currentPreference);
}

export function getThemePreference(): ThemePreference {
  return currentPreference;
}

export function getThemeTokens(): ThemeTokens {
  return currentTokens;
}

/** Subscribes to theme changes (manual toggle, or the system preference when following it). */
export function onThemeChange(listener: ThemeChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
  currentPreference = preference;
  applyDomAttribute(preference);
  notify();
  await getStorage().set(THEME_STORAGE_KEY, preference);
}

/** Cycles system -> light -> dark -> system, applies it and returns the new preference. */
export function cycleTheme(): ThemePreference {
  const order: readonly ThemePreference[] = ['system', 'light', 'dark'];
  const currentIndex = order.indexOf(currentPreference);
  const next = order[(currentIndex + 1) % order.length] ?? 'system';
  void setThemePreference(next);
  return next;
}

/** Loads the persisted preference, applies it, resolves tokens and starts watching the system
 * preference. Call once at boot, before mounting anything that reads theme tokens. */
export async function initTheme(): Promise<ThemePreference> {
  const stored = await getStorage().get<ThemePreference>(THEME_STORAGE_KEY);
  currentPreference =
    stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  applyDomAttribute(currentPreference);
  currentTokens = resolveThemeTokens();

  if (!mediaQuery && typeof matchMedia === 'function') {
    mediaQuery = matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', () => {
      if (currentPreference === 'system') notify();
    });
  }

  return currentPreference;
}
