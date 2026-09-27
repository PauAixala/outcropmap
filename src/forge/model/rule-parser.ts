/**
 * Parser for anvil rule strings as stored in src/data/<profile>/anvil-recipes.json, e.g.
 * "punch_last". A rule string is `<action>_<position>`: the action name (hit / draw / punch /
 * bend / upset / shrink) plus one of the position suffixes used by `ForgeRule` in TFC 1.20.x —
 * net/dries007/tfc/common/capabilities/forge/ForgeRule.java, commit b158c9c:
 * last / second_last / third_last / any / not_last. "hit" means any hit strength (light, medium
 * or hard); the other action names name a single concrete step.
 */
import type { ActionType, ForgeRule, HitStrength, RulePosition } from './types';

/** Longest suffixes first, so e.g. "second_last" is never misread as something ending in "_last". */
const POSITION_SUFFIXES: ReadonlyArray<readonly [string, RulePosition]> = [
  ['second_last', 'SECOND_LAST'],
  ['third_last', 'THIRD_LAST'],
  ['not_last', 'NOT_LAST'],
  ['last', 'LAST'],
  ['any', 'ANY'],
];

const ACTION_NAMES: ReadonlyArray<readonly [string, ActionType]> = [
  ['hit_light', 'HIT'],
  ['hit_medium', 'HIT'],
  ['hit_hard', 'HIT'],
  ['hit', 'HIT'],
  ['draw', 'DRAW'],
  ['punch', 'PUNCH'],
  ['bend', 'BEND'],
  ['upset', 'UPSET'],
  ['shrink', 'SHRINK'],
];

/**
 * Parses a rule string such as "hit_second_last" into the typed rule `{ type, position }`.
 * Throws an Error naming the offending string when it does not fit `<action>_<position>` —
 * malformed rules are never skipped silently.
 */
export function parseRule(ruleString: string): ForgeRule {
  for (const [suffix, position] of POSITION_SUFFIXES) {
    if (!ruleString.endsWith(`_${suffix}`)) continue;
    const actionName = ruleString.slice(0, -1 - suffix.length);
    const match = ACTION_NAMES.find(([name]) => name === actionName);
    if (match !== undefined) {
      const strengthName = match[0].slice('hit_'.length);
      const strength: HitStrength | undefined =
        strengthName === 'light'
          ? 'LIGHT'
          : strengthName === 'medium'
            ? 'MEDIUM'
            : strengthName === 'hard'
              ? 'HARD'
              : undefined;
      return strength === undefined
        ? { type: match[1], position }
        : { type: match[1], position, strength };
    }
  }
  throw new Error(
    `Unparseable anvil rule "${ruleString}": expected <action>_<position>, e.g. "punch_last"`,
  );
}
