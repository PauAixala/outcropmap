import type { GeneratorSettings, ProfileDescriptor } from './types';

/** Accept only a profile's known, finite settings; defaults and bounds belong to the profile. */
export function normalizeSettings(
  profile: ProfileDescriptor,
  settings: GeneratorSettings = {},
): GeneratorSettings {
  const normalized: Record<string, number> = {};
  for (const setting of profile.settings ?? []) {
    const raw = settings[setting.id];
    const value = raw !== undefined && Number.isFinite(raw) ? raw : setting.defaultValue;
    const bounded = Math.max(setting.min, Math.min(setting.max, value));
    normalized[setting.id] = setting.integer ? Math.trunc(bounded) : bounded;
  }
  return normalized;
}
