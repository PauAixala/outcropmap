/**
 * The TFC anvil model. See docs/FORGING-NOTES.md — and read the deltas out of the mod data rather
 * than trusting any table written by hand.
 */

export type ActionType = 'HIT' | 'DRAW' | 'PUNCH' | 'BEND' | 'UPSET' | 'SHRINK';

export type HitStrength = 'LIGHT' | 'MEDIUM' | 'HARD';

export interface AnvilAction {
  readonly id: string;
  readonly type: ActionType;
  /** Required for HIT actions and absent for every other action. */
  readonly strength?: HitStrength;
  /** How much this action moves the work value. Loaded from src/data/<profile>/anvil.json. */
  readonly delta: number;
  readonly labelKey: string;
}

/** Where in the final steps a rule applies. */
export type RulePosition = 'LAST' | 'SECOND_LAST' | 'THIRD_LAST' | 'ANY' | 'NOT_LAST';

export interface ForgeRule {
  readonly type: ActionType;
  readonly position: RulePosition;
  /** Only meaningful for HIT rules; absent means any hit strength. */
  readonly strength?: HitStrength;
}

export interface Recipe {
  readonly id: string;
  readonly name: string;
  readonly profile: string;
  readonly target: number;
  readonly rules: readonly ForgeRule[];
  readonly tier?: number;
  readonly input?: string;
  readonly result?: string;
  readonly custom: boolean;
  readonly notes?: string;
}

export interface Solution {
  readonly steps: readonly AnvilAction[];
  readonly totalSteps: number;
  /** Distinct action types used — fewer is easier for a human to execute. */
  readonly distinctActions: number;
}

export interface SolveInput {
  readonly start: number;
  readonly target: number;
  readonly rules: readonly ForgeRule[];
  readonly actions: readonly AnvilAction[];
  /** The work bar bounds; a sequence that leaves them mid-way is invalid, not merely worse. */
  readonly minValue: number;
  readonly maxValue: number;
  readonly maxSolutions: number;
}
