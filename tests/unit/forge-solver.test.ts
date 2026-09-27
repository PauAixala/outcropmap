import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRule } from '../../src/forge/model/rule-parser';
import { solve } from '../../src/forge/solver/solve';
import { WORK_MAX, WORK_MIN, WORK_START, actionsForProfile } from '../../src/forge/model/actions';
import type { AnvilAction, ForgeRule } from '../../src/forge/model/types';

const recipesJsonPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/data/tfc-1.20/anvil-recipes.json',
);

describe('parseRule', () => {
  it('parses every position suffix into the typed rule', () => {
    expect(parseRule('punch_last')).toEqual({ type: 'PUNCH', position: 'LAST' });
    expect(parseRule('hit_second_last')).toEqual({ type: 'HIT', position: 'SECOND_LAST' });
    expect(parseRule('draw_third_last')).toEqual({ type: 'DRAW', position: 'THIRD_LAST' });
    expect(parseRule('bend_any')).toEqual({ type: 'BEND', position: 'ANY' });
    expect(parseRule('shrink_not_last')).toEqual({ type: 'SHRINK', position: 'NOT_LAST' });
    expect(parseRule('hit_light_last')).toEqual({
      type: 'HIT',
      strength: 'LIGHT',
      position: 'LAST',
    });
    expect(parseRule('hit_hard_second_last')).toEqual({
      type: 'HIT',
      strength: 'HARD',
      position: 'SECOND_LAST',
    });
  });

  it('throws an error naming the string when a rule does not fit <action>_<position>', () => {
    const bad = [
      'punch',
      '_last',
      'flamethrower_last',
      'hit_ultimate',
      'hit_heavy_last',
      'last_punch',
      '',
      'hit second last',
    ];
    for (const s of bad) {
      let threw = false;
      try {
        parseRule(s);
      } catch (err) {
        threw = true;
        if (s.length > 0 && err instanceof Error) {
          expect(err.message).toContain('Unparseable anvil rule');
          expect(err.message).toContain(s);
        }
      }
      expect(threw, `expected parseRule(${JSON.stringify(s)}) to throw`).toBe(true);
    }
  });

  it('parses every rule string that appears in anvil-recipes.json', () => {
    const data = JSON.parse(readFileSync(recipesJsonPath, 'utf8')) as {
      recipes: Record<string, { rules?: unknown }>;
    };
    const seen = new Set<string>();
    for (const recipe of Object.values(data.recipes)) {
      if (!Array.isArray(recipe.rules)) continue;
      for (const rule of recipe.rules) {
        if (typeof rule !== 'string')
          throw new Error(`unexpected non-string rule: ${String(rule)}`);
        seen.add(rule);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    // Spot-check that the file really contains all five positions and every action.
    for (const expected of [
      'punch_last',
      'hit_second_last',
      'upset_third_last',
      'bend_any',
      'draw_not_last',
      'shrink_third_last',
    ]) {
      expect(seen.has(expected)).toBe(true);
    }
    for (const ruleString of seen) {
      const parsed = parseRule(ruleString); // must not throw
      expect(['HIT', 'DRAW', 'PUNCH', 'BEND', 'UPSET', 'SHRINK']).toContain(parsed.type);
      expect(['LAST', 'SECOND_LAST', 'THIRD_LAST', 'ANY', 'NOT_LAST']).toContain(parsed.position);
    }
  });
});

const actions: readonly AnvilAction[] = [
  { id: 'hit_light', type: 'HIT', strength: 'LIGHT', delta: -3, labelKey: 'light' },
  { id: 'hit_medium', type: 'HIT', strength: 'MEDIUM', delta: -6, labelKey: 'medium' },
  { id: 'punch', type: 'PUNCH', delta: 2, labelKey: 'punch' },
  { id: 'bend', type: 'BEND', delta: 7, labelKey: 'bend' },
];

function input(target: number, rules: readonly ForgeRule[] = [], maxSolutions = 4) {
  return { start: 0, target, rules, actions, minValue: -10, maxValue: 10, maxSolutions };
}

describe('solve', () => {
  it('matches exhaustive search for generic and concrete hit inputs', () => {
    const allHits: readonly AnvilAction[] = [
      { id: 'hit_light', type: 'HIT', strength: 'LIGHT', delta: -3, labelKey: 'light' },
      { id: 'hit_medium', type: 'HIT', strength: 'MEDIUM', delta: -6, labelKey: 'medium' },
      { id: 'hit_hard', type: 'HIT', strength: 'HARD', delta: -9, labelKey: 'hard' },
    ];
    const ruleCases: readonly (readonly ForgeRule[])[] = [
      [{ type: 'HIT', position: 'LAST' }],
      [{ type: 'HIT', position: 'ANY' }],
      [{ type: 'HIT', position: 'NOT_LAST' }],
      [{ type: 'HIT', position: 'LAST', strength: 'LIGHT' }],
      [{ type: 'HIT', position: 'SECOND_LAST', strength: 'MEDIUM' }],
      [{ type: 'HIT', position: 'THIRD_LAST', strength: 'HARD' }],
    ];
    const matchesRule = (steps: readonly AnvilAction[], rule: ForgeRule): boolean => {
      const matches = (step: AnvilAction | undefined) =>
        step?.type === 'HIT' && (rule.strength === undefined || step.strength === rule.strength);
      if (rule.position === 'LAST') return matches(steps.at(-1));
      if (rule.position === 'SECOND_LAST') return matches(steps.at(-2));
      if (rule.position === 'THIRD_LAST') return matches(steps.at(-3));
      if (rule.position === 'NOT_LAST') return steps.slice(-3, -1).some(matches);
      return steps.slice(-3).some(matches);
    };
    for (const rules of ruleCases) {
      for (const target of [0, 3, 6, 9, 12, 15]) {
        let frontier: AnvilAction[][] = [[]];
        const expected: AnvilAction[][] = [];
        for (let depth = 1; depth <= 6; depth++) {
          frontier = frontier
            .flatMap((steps) => allHits.map((action) => [...steps, action]))
            .filter((steps) => 18 + steps.reduce((sum, action) => sum + action.delta, 0) >= 0);
          expected.push(
            ...frontier.filter(
              (steps) =>
                18 + steps.reduce((sum, action) => sum + action.delta, 0) === target &&
                rules.every((rule) => matchesRule(steps, rule)),
            ),
          );
        }
        expected.sort(
          (a, b) =>
            a.length - b.length ||
            new Set(a.map((step) => step.id)).size - new Set(b.map((step) => step.id)).size ||
            a
              .map((step) => allHits.indexOf(step))
              .join('')
              .localeCompare(b.map((step) => allHits.indexOf(step)).join('')),
        );
        expect(
          solve({
            start: 18,
            target,
            rules,
            actions: allHits,
            minValue: 0,
            maxValue: 18,
            maxSolutions: 4,
          }).map((solution) => solution.steps),
        ).toEqual(expected.slice(0, 4));
      }
    }
  });

  it('matches exhaustive ranked alternatives on a small bounded bar', () => {
    const smallActions = actions.filter((action) => action.id !== 'hit_medium');
    for (const target of [1, 2, 4, 7, 9]) {
      let frontier: AnvilAction[][] = [[]];
      const expected: AnvilAction[][] = [];
      for (let depth = 1; depth <= 10; depth++) {
        frontier = frontier
          .flatMap((steps) => smallActions.map((action) => [...steps, action]))
          .filter((steps) => {
            const value = steps.reduce((sum, action) => sum + action.delta, 0);
            return value >= 0 && value <= 10;
          });
        // The anvil stops at the first strike that lands on target with the rules met (none here),
        // so a sequence that passes through the target earlier is never struck to its end.
        const finishesEarly = (steps: readonly AnvilAction[]): boolean =>
          steps.slice(0, -1).some((_, index) =>
            steps.slice(0, index + 1).reduce((sum, action) => sum + action.delta, 0) === target,
          );
        expected.push(
          ...frontier.filter(
            (steps) =>
              steps.reduce((sum, action) => sum + action.delta, 0) === target && !finishesEarly(steps),
          ),
        );
        if (expected.length >= 3) break;
      }
      expected.sort(
        (a, b) =>
          a.length - b.length ||
          new Set(a.map((s) => s.type)).size - new Set(b.map((s) => s.type)).size ||
          a
            .map((s) => smallActions.indexOf(s))
            .join('')
            .localeCompare(b.map((s) => smallActions.indexOf(s)).join('')),
      );
      expect(expected.length).toBeGreaterThanOrEqual(3);
      expect(
        solve({ ...input(target), actions: smallActions, minValue: 0, maxSolutions: 3 }).map(
          (s) => s.steps,
        ),
      ).toEqual(expected.slice(0, 3));
    }
  });

  it('honours each hit intensity and accepts all three for an unrestricted hit', () => {
    const hits: AnvilAction[] = [
      ...actions.filter((a) => a.type === 'HIT'),
      { id: 'hit_hard', type: 'HIT', strength: 'HARD', delta: -9, labelKey: 'hard' },
    ];
    for (const hit of hits) {
      if (hit.strength === undefined) throw new Error('Test hit is missing its strength');
      for (const rule of [
        { type: 'HIT', position: 'LAST' } as const,
        { type: 'HIT', position: 'LAST', strength: hit.strength } as const,
      ]) {
        const result = solve({
          ...input(10 + hit.delta, [rule]),
          start: 10,
          actions: hits,
          minValue: 0,
          maxSolutions: 1,
        });
        expect(result[0]?.steps).toEqual([hit]);
      }
    }
    expect(solve(input(0))[0]?.steps).toEqual([]);
  });
  it('solves a hand-calculated target and satisfies a generic hit rule', () => {
    const result = solve(
      input(-1, [
        { type: 'HIT', position: 'SECOND_LAST' },
        { type: 'PUNCH', position: 'LAST' },
      ]),
    );
    expect(result[0]?.steps.map((step) => step.id)).toEqual(['hit_light', 'punch']);
    expect(result[0]).toMatchObject({ totalSteps: 2, distinctActions: 2 });
  });

  it('returns only exact, in-range, rule-satisfying sequences', () => {
    const rules: readonly ForgeRule[] = [
      { type: 'BEND', position: 'NOT_LAST' },
      { type: 'PUNCH', position: 'LAST' },
    ];
    const result = solve(input(9, rules));
    expect(result.length).toBeGreaterThan(0);
    for (const solution of result) {
      let value = 0;
      for (const step of solution.steps) {
        value += step.delta;
        expect(value).toBeGreaterThanOrEqual(-10);
        expect(value).toBeLessThanOrEqual(10);
      }
      expect(value).toBe(9);
      expect(solution.steps.at(-1)?.type).toBe('PUNCH');
      expect(solution.steps.slice(0, -1).some((step) => step.type === 'BEND')).toBe(true);
    }
  });

  it('matches explicit hit strengths while generic HIT accepts every strength', () => {
    const mediumOnly = solve(input(-6, [{ type: 'HIT', strength: 'MEDIUM', position: 'LAST' }]));
    expect(mediumOnly[0]?.steps.map((step) => step.id)).toEqual(['hit_medium']);
    const generic = solve(input(-6, [{ type: 'HIT', position: 'LAST' }]));
    expect(generic.some((solution) => solution.steps.at(-1)?.id === 'hit_medium')).toBe(true);
  });

  it('rejects wildcard hit actions and strengths on non-hit actions', () => {
    const wildcard = { id: 'hit', type: 'HIT', delta: -3, labelKey: 'hit' } as AnvilAction;
    const malformedPunch = {
      id: 'punch_light',
      type: 'PUNCH',
      strength: 'LIGHT',
      delta: 2,
      labelKey: 'punch',
    } as AnvilAction;
    expect(solve({ ...input(-3), actions: [wildcard] })).toEqual([]);
    expect(solve({ ...input(2), actions: [malformedPunch] })).toEqual([]);
  });

  it('always returns one of the three concrete hit strengths', () => {
    const allHits: readonly AnvilAction[] = [
      { id: 'hit_light', type: 'HIT', strength: 'LIGHT', delta: -3, labelKey: 'light' },
      { id: 'hit_medium', type: 'HIT', strength: 'MEDIUM', delta: -6, labelKey: 'medium' },
      { id: 'hit_hard', type: 'HIT', strength: 'HARD', delta: -9, labelKey: 'hard' },
    ];
    for (const target of [-3, -6, -9]) {
      const solutions = solve({
        ...input(target, [{ type: 'HIT', position: 'LAST' }]),
        actions: allHits,
        minValue: -20,
      });
      expect(solutions.length).toBeGreaterThan(0);
      for (const solution of solutions) {
        expect(['LIGHT', 'MEDIUM', 'HARD']).toContain(solution.steps.at(-1)?.strength);
      }
    }
  });

  it('counts the three hit strengths as distinct output actions', () => {
    const allHits: readonly AnvilAction[] = [
      actions[0]!,
      actions[1]!,
      { id: 'hit_hard', type: 'HIT', strength: 'HARD', delta: -9, labelKey: 'hard' },
    ];
    const result = solve({
      ...input(-18, [], 1),
      actions: allHits,
      minValue: -30,
      maxValue: 0,
    });
    expect(result[0]?.steps.map((step) => step.id)).toEqual(['hit_hard', 'hit_hard']);
    expect(result[0]?.distinctActions).toBe(1);
  });

  it('uses ANY and NOT_LAST only within the final three actions', () => {
    const any = solve(input(1, [{ type: 'BEND', position: 'ANY' }]));
    expect(
      any.every((solution) => solution.steps.slice(-3).some((step) => step.type === 'BEND')),
    ).toBe(true);
    const noOldBend = solve({
      ...input(1, [{ type: 'BEND', position: 'ANY' }]),
      actions: actions.slice(0, 3),
    });
    expect(noOldBend).toEqual([]);
  });

  it('returns the zero-step solution when already at target without rules', () => {
    expect(solve({ ...input(0), actions: [] })).toEqual([
      { steps: [], totalSteps: 0, distinctActions: 0 },
    ]);
  });

  it('is reproducible and returns an empty list for impossible targets', () => {
    const rules: readonly ForgeRule[] = [{ type: 'PUNCH', position: 'LAST' }];
    expect(solve(input(-1, rules))).toEqual(solve(input(-1, rules)));
    expect(solve({ ...input(1), actions: actions.slice(1, 3) })).toEqual([]);
  });

  it('does not use a path that would leave the work bar', () => {
    const narrow = { ...input(2), minValue: 0, maxValue: 2 };
    const result = solve(narrow);
    expect(result.length).toBeGreaterThan(0);
    for (const solution of result) {
      let value = 0;
      for (const step of solution.steps) {
        value += step.delta;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('why a solve failed', () => {
  // The panel distinguishes "the rules block it" from "the target is out of reach" by re-solving
  // without the rules. These pin that the two cases really are distinguishable that way, so the
  // message the panel picks is not a guess.
  const actions = actionsForProfile('tfc-1.20');
  const base = {
    start: WORK_START,
    minValue: WORK_MIN,
    maxValue: WORK_MAX,
    actions,
    maxSolutions: 1,
  } as const;

  it('finds a plain target reachable, and the same target unreachable under contradictory rules', () => {
    const target = 60;
    expect(solve({ ...base, target, rules: [] }).length).toBeGreaterThan(0);
    // A rule set no sequence can satisfy: the last step cannot be two different actions at once.
    const contradictory = [
      { type: 'HIT', position: 'LAST' },
      { type: 'DRAW', position: 'LAST' },
    ] as const;
    expect(solve({ ...base, target, rules: [...contradictory] })).toEqual([]);
  });

  it('reports no solution for a target outside the work bar even with no rules', () => {
    expect(solve({ ...base, target: WORK_MAX + 1, rules: [] })).toEqual([]);
  });
});

describe('an alternative the anvil would finish early', () => {
  // TFC checks the recipe after every strike (AnvilBlockEntity.java:313, AnvilRecipe.checkComplete),
  // so a sequence that is on target with its rules met before its last strike ends right there.
  // With maxSolutions 5, ten of the alternatives at targets 0 to 3 did exactly that.
  const actions = actionsForProfile('tfc-1.20');
  // Every rule set a real recipe uses: the old solver's early finishers came from these (five of
  // them at targets 0 to 3 on the TerraFirmaGreg catalogue of 2026-09-25).
  const ruleSets: readonly (readonly ForgeRule[])[] = [
    ...new Set(
      ['../../src/data/tfc-1.20/anvil-recipes.json', '../../src/data/tfg/anvil-recipes.json'].flatMap((file) =>
        Object.values(
          (
            JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), file), 'utf8')) as {
              recipes: Record<string, { rules?: readonly string[] }>;
            }
          ).recipes,
        ).map((recipe) => (recipe.rules ?? []).join(',')),
      ),
    ),
  ].map((joined) => (joined === '' ? [] : joined.split(',').map(parseRule)));
  const ruleMet = (rule: ForgeRule, steps: readonly AnvilAction[]): boolean => {
    const is = (step: AnvilAction | undefined): boolean =>
      step !== undefined && step.type === rule.type && (rule.strength === undefined || step.strength === rule.strength);
    if (rule.position === 'LAST') return is(steps.at(-1));
    if (rule.position === 'SECOND_LAST') return is(steps.at(-2));
    if (rule.position === 'THIRD_LAST') return is(steps.at(-3));
    if (rule.position === 'NOT_LAST') return steps.slice(-3, -1).some(is);
    return steps.slice(-3).some(is);
  };

  it('offers only sequences the anvil strikes to their last step', () => {
    const early: string[] = [];
    let offered = 0;
    for (const rules of ruleSets) {
      for (const target of [0, 1, 2, 3]) {
        const solutions = solve({ start: WORK_START, target, rules, actions, minValue: WORK_MIN, maxValue: WORK_MAX, maxSolutions: 5 });
        offered += solutions.length;
        for (const solution of solutions) {
          let value = WORK_START;
          solution.steps.slice(0, -1).forEach((step, index) => {
            value += step.delta;
            const prefix = solution.steps.slice(0, index + 1);
            if (value === target && rules.every((rule) => ruleMet(rule, prefix))) {
              early.push(`target ${target} [${rules.map((r) => `${r.type}_${r.position}`).join(',')}]: ${solution.steps.map((s) => s.id).join(' ')}`);
            }
          });
        }
      }
    }
    expect(ruleSets.length).toBeGreaterThan(20);
    expect(offered).toBeGreaterThan(200);
    expect(early).toEqual([]);
  });
});
