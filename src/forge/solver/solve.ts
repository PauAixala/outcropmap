/**
 * Anvil solver: find action sequences from `start` to exactly `target` whose final steps satisfy
 * the recipe rules, never leaving the work bar.
 *
 * Strategy (docs/FORGING-NOTES.md):
 *   1. Enumerate the concrete tails (last 1-3 actions) that satisfy the rules.
 *   2. Solve the remaining sum with the free actions — bounded coin problem, BFS or DP.
 *   3. Reject sequences that run off either end of the bar at any point.
 *   4. Rank: fewest steps, then fewest distinct action types, then a stable order.
 *
 * Pure and synchronous: no DOM, no storage. Fully unit-tested (Phase 9).
 */
import type { AnvilAction, ForgeRule, HitStrength, Solution, SolveInput } from '../model/types';

interface Path {
  readonly steps: readonly AnvilAction[];
  readonly value: number;
  readonly usedActions: bigint;
}

function matches(action: AnvilAction, rule: ForgeRule): boolean {
  return (
    action.type === rule.type &&
    (rule.type !== 'HIT' || rule.strength === undefined || action.strength === rule.strength)
  );
}

function satisfiesRule(rule: ForgeRule, path: Path): boolean {
  const { steps } = path;
  switch (rule.position) {
    case 'LAST': {
      const action = steps[steps.length - 1];
      return action !== undefined && matches(action, rule);
    }
    case 'SECOND_LAST': {
      const action = steps[steps.length - 2];
      return action !== undefined && matches(action, rule);
    }
    case 'THIRD_LAST': {
      const action = steps[steps.length - 3];
      return action !== undefined && matches(action, rule);
    }
    case 'ANY':
      return steps.slice(-3).some((action) => matches(action, rule));
    case 'NOT_LAST':
      return steps.slice(-3, -1).some((action) => matches(action, rule));
  }
}

function satisfiesAll(rules: readonly ForgeRule[], path: Path): boolean {
  return rules.every((rule) => satisfiesRule(rule, path));
}

function stateKey(path: Path): string {
  return `${path.value}|${path.usedActions}`;
}

function compareSteps(
  left: readonly AnvilAction[],
  right: readonly AnvilAction[],
  order: ReadonlyMap<string, number>,
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftOrder = order.get(left[index]?.id ?? '') ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right[index]?.id ?? '') ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  }
  return left.length - right.length;
}

function distinctCount(steps: readonly AnvilAction[]): number {
  return new Set(steps.map((step) => step.id)).size;
}

const HIT_STRENGTHS: readonly HitStrength[] = ['LIGHT', 'MEDIUM', 'HARD'];

function isHitStrength(value: unknown): value is HitStrength {
  return HIT_STRENGTHS.includes(value as HitStrength);
}

function isConcreteAction(action: AnvilAction): boolean {
  return action.type === 'HIT' ? isHitStrength(action.strength) : action.strength === undefined;
}

function staysInRange(
  value: number,
  steps: readonly AnvilAction[],
  minValue: number,
  maxValue: number,
): boolean {
  for (const action of steps) {
    value += action.delta;
    if (value < minValue || value > maxValue) return false;
  }
  return true;
}

/**
 * Would the anvil finish this sequence before its last strike?
 *
 * TFC re-checks the recipe after every strike: `AnvilBlockEntity.work` adds the step and then asks
 * `recipe.checkComplete` (line 313 at b158c9c9), which is "the work is on target and the rules
 * match the last three steps" (`AnvilRecipe.checkComplete`, line 93). So a sequence that passes
 * through the target with its rules already met is over at that strike, and the rest of it is
 * never struck: as an answer it is wrong, whatever it adds up to. The shortest solution can never
 * do this -- its early finish would be a shorter solution -- but alternatives can, and at targets 0
 * to 3 ten of them did.
 */
function finishesEarly(start: number, target: number, rules: readonly ForgeRule[], path: Path): boolean {
  let value = start;
  for (let index = 0; index < path.steps.length - 1; index++) {
    value += path.steps[index]?.delta ?? 0;
    if (value !== target) continue;
    const prefix: Path = { steps: path.steps.slice(0, index + 1), value, usedActions: 0n };
    if (satisfiesAll(rules, prefix)) return true;
  }
  return false;
}

/** Finds shortest bounded, rule-satisfying action sequences in deterministic order. */
export function solve(input: SolveInput): Solution[] {
  const { start, target, minValue, maxValue, rules, actions, maxSolutions } = input;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(target) ||
    !Number.isInteger(minValue) ||
    !Number.isInteger(maxValue) ||
    !Number.isInteger(maxSolutions) ||
    minValue > maxValue ||
    start < minValue ||
    start > maxValue ||
    target < minValue ||
    target > maxValue ||
    maxSolutions <= 0 ||
    actions.some((action) => !Number.isInteger(action.delta) || !isConcreteAction(action))
  ) {
    return [];
  }
  if (
    rules.some(
      (rule) =>
        (rule.type === 'HIT' && rule.strength !== undefined && !isHitStrength(rule.strength)) ||
        (rule.type !== 'HIT' && rule.strength !== undefined),
    )
  )
    return [];

  const initial: Path = { steps: [], value: start, usedActions: 0n };
  if (start === target && rules.length === 0)
    return [{ steps: [], totalSteps: 0, distinctActions: 0 }];
  if (actions.length === 0) {
    return start === target && rules.length === 0
      ? [{ steps: [], totalSteps: 0, distinctActions: 0 }]
      : [];
  }
  const actionOrder = new Map<string, number>();
  actions.forEach((action, index) => actionOrder.set(action.id, index));
  const candidates: Path[] = [];
  /** A sequence is only an answer if the anvil would not stop short of its last strike. */
  const offer = (path: Path): void => {
    if (!finishesEarly(start, target, rules, path)) candidates.push(path);
  };
  const tails: Path[] = [];
  const visitTail = (tail: readonly number[]): void => {
    const steps = tail
      .map((index) => actions[index])
      .filter((action): action is AnvilAction => action !== undefined);
    if (steps.length !== tail.length) return;
    const sum = steps.reduce((total, action) => total + action.delta, 0);
    const tailPath: Path = {
      steps,
      value: sum,
      usedActions: tail.reduce((mask, index) => mask | (1n << BigInt(index)), 0n),
    };
    if (
      target - sum >= minValue &&
      target - sum <= maxValue &&
      staysInRange(target - sum, steps, minValue, maxValue) &&
      satisfiesAll(rules, tailPath)
    )
      tails.push(tailPath);
  };
  for (let first = 0; first < actions.length; first++)
    for (let second = 0; second < actions.length; second++)
      for (let third = 0; third < actions.length; third++) visitTail([first, second, third]);

  // Also cover the only valid sequences shorter than the three-step rule window.
  let shortFrontier: Path[] = [initial];
  for (let length = 1; length < 3; length++) {
    const nextShort: Path[] = [];
    for (const path of shortFrontier)
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        if (action === undefined) continue;
        const value = path.value + action.delta;
        if (value >= minValue && value <= maxValue) {
          const next = {
            steps: [...path.steps, action],
            value,
            usedActions: path.usedActions | (1n << BigInt(index)),
          };
          nextShort.push(next);
          if (satisfiesAll(rules, next) && value === target) offer(next);
        }
      }
    shortFrontier = nextShort;
  }

  const needed = new Set<number>();
  for (const tail of tails) needed.add(target - tail.value);
  if (needed.size > 0) {
    let frontier: Path[] = [initial];
    const retained = new Map<string, Path[]>();
    retained.set(stateKey(initial), [initial]);
    for (const tail of tails)
      if (tail.value === target - start && staysInRange(start, tail.steps, minValue, maxValue))
        offer({ steps: [...tail.steps], value: target, usedActions: tail.usedActions });
    while (frontier.length > 0) {
      // Each complete frontier has supplied every candidate of this length. Longer
      // prefixes cannot improve the first K results, including their tie breakers.
      if (candidates.length >= maxSolutions) break;
      const next: Path[] = [];
      for (const path of frontier)
        for (let index = 0; index < actions.length; index++) {
          const action = actions[index];
          if (action === undefined) continue;
          const value = path.value + action.delta;
          if (value < minValue || value > maxValue) continue;
          const nextPath: Path = {
            steps: [...path.steps, action],
            value,
            usedActions: path.usedActions | (1n << BigInt(index)),
          };
          const key = stateKey(nextPath);
          const paths = retained.get(key);
          if (paths === undefined) {
            retained.set(key, [nextPath]);
            next.push(nextPath);
          } else if (
            paths.length < maxSolutions &&
            !paths.some(
              (candidate) => compareSteps(candidate.steps, nextPath.steps, actionOrder) === 0,
            )
          ) {
            paths.push(nextPath);
            next.push(nextPath);
          }
        }
      frontier = next;
      for (const path of frontier)
        if (needed.has(path.value))
          for (const tail of tails.filter((candidate) => target - candidate.value === path.value)) {
            if (staysInRange(path.value, tail.steps, minValue, maxValue))
              offer({
                steps: [...path.steps, ...tail.steps],
                value: target,
                usedActions: path.usedActions | tail.usedActions,
              });
          }
    }
  }
  const unique = new Map<string, Path>();
  for (const path of candidates)
    if (path.value === target) unique.set(path.steps.map((step) => step.id).join('\u0000'), path);
  return [...unique.values()]
    .sort(
      (left, right) =>
        left.steps.length - right.steps.length ||
        distinctCount(left.steps) - distinctCount(right.steps) ||
        compareSteps(left.steps, right.steps, actionOrder),
    )
    .slice(0, maxSolutions)
    .map((path) => ({
      steps: path.steps,
      totalSteps: path.steps.length,
      distinctActions: distinctCount(path.steps),
    }));
}
