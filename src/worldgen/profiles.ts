/**
 * Registers every world generation profile by importing its module for the side effect.
 *
 * This lives apart from `registry.ts` on purpose: a profile module imports the registry, so having
 * the registry import the profiles closes a cycle and the registration runs before the registry's
 * own module body has initialised. Entry points (pages, workers, tests) import this module.
 */
import './tfc-1.20';
import './tfg';
// TODO: './tfc-1.18', './vanilla'.
