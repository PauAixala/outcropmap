/**
 * The only place that knows which version profiles exist. Everything else asks for a generator by
 * profile id. If you are branching on a version anywhere else, the abstraction is wrong.
 */
import type {
  GeneratorFactory,
  GeneratorOptions,
  ProfileDescriptor,
  ProfileId,
  WorldGenerator,
} from './api/types';
import { normalizeSettings } from './api/settings';

interface RegistryEntry {
  readonly descriptor: ProfileDescriptor;
  readonly create: GeneratorFactory;
}

const entries = new Map<ProfileId, RegistryEntry>();

export function registerProfile(descriptor: ProfileDescriptor, create: GeneratorFactory): void {
  if (entries.has(descriptor.id)) {
    throw new Error(`Profile already registered: ${descriptor.id}`);
  }
  entries.set(descriptor.id, { descriptor, create });
}

export function listProfiles(): readonly ProfileDescriptor[] {
  return [...entries.values()].map((e) => e.descriptor);
}

export function getProfile(id: ProfileId): ProfileDescriptor {
  const entry = entries.get(id);
  if (!entry) throw new Error(`Unknown profile: ${id}`);
  return entry.descriptor;
}

export function createGenerator(id: ProfileId, options: GeneratorOptions): WorldGenerator {
  const entry = entries.get(id);
  if (!entry) throw new Error(`Unknown profile: ${id}`);
  return entry.create({ ...options, settings: normalizeSettings(entry.descriptor, options.settings) });
}

// Profiles are registered by src/worldgen/profiles.ts, which entry points import. Importing them
// from here would close an import cycle (profile -> registry -> profile).

