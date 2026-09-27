/**
 * The solve panel (docs/PLAN.md 10c P2): a target field, a Solve button and the resulting step
 * sequence, rendered **inside the box of whichever recipe is selected** — under the finishing rules
 * for a catalogue recipe, under the rule editor for a custom one. One component serves both, so a
 * saved recipe and a built-in recipe answer the same way.
 *
 * Solving never requires saving: the custom editor passes whatever is currently typed in.
 *
 * Where the target comes from: TFC does not store one in the recipe, it derives it per world from
 * the seed and the recipe id (`anvilTargetWork`, docs/FORGING-NOTES.md). Given a seed the caller
 * fills the field in through `setTarget`; the field stays editable, because the number on the
 * player's anvil is always the authority.
 */
import {
  WORK_MAX,
  WORK_MIN,
  WORK_START,
  actionsForProfile,
  solve,
  type AnvilAction,
  type ForgeRule,
  type RulePosition,
} from '@forge/index';
import { en } from '@ui/i18n/en';

/** What the caller knows when Solve is pressed: either a solvable problem, or why it is not. */
export type SolveRead =
  | { readonly ok: true; readonly rules: readonly ForgeRule[]; readonly target?: number }
  | { readonly ok: false; readonly error: string };

export interface SolvePanelOptions {
  /** Selected profile id, so the deltas come from that profile's extracted data. */
  readonly profile: () => string;
  /** Reads the current recipe state. Called on every Solve press — nothing is cached. */
  readonly read: () => SolveRead;
  /**
   * True when this panel owns the target field. The custom editor already has one, so it passes
   * false and returns the target from `read()` instead.
   */
  readonly ownTargetField: boolean;
}

export interface SolvePanel {
  /** Clears any rendered solution — call when the selected recipe changes. */
  clear(): void;
  /**
   * Fills the target field from the world seed and solves; `null` empties it again. Only meaningful
   * on a panel that owns the field.
   */
  setTarget(target: number | null): void;
  /** Solves the current inputs, used by both the button and saved-recipe opening. */
  solve(): void;
  /** Solves if the inputs are complete and valid; otherwise does nothing, silently. */
  trySolve(): void;
  readonly element: HTMLElement;
}

/** Which of the final three steps a rule governs, for the badge on a step. */
const FINAL_POSITIONS: readonly RulePosition[] = ['LAST', 'SECOND_LAST', 'THIRD_LAST'];

function actionLabel(action: AnvilAction): string {
  return action.strength
    ? en.forge.hitStrengthNames[action.strength]
    : en.forge.actionNames[action.type];
}

export function mountSolvePanel(container: HTMLElement, options: SolvePanelOptions): SolvePanel {
  const panel = document.createElement('div');
  panel.className = 'forge-solve';

  const controls = document.createElement('div');
  controls.className = 'forge-solve__controls';

  let targetInput: HTMLInputElement | null = null;
  if (options.ownTargetField) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = String(WORK_MIN);
    input.max = String(WORK_MAX);
    input.className = 'forge-solve__target';
    input.placeholder = en.forge.solveTargetPlaceholder;
    const label = document.createElement('label');
    label.className = 'field-label';
    label.append(document.createTextNode(en.forge.solveTargetLabel), input);
    controls.append(label);
    targetInput = input;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'forge-btn forge-btn--primary forge-solve__button';
  button.textContent = en.forge.solveButton;
  controls.append(button);

  const hint = document.createElement('p');
  hint.className = 'forge-solve__hint';
  if (options.ownTargetField) hint.textContent = en.forge.solveTargetHint;

  const result = document.createElement('div');
  result.className = 'forge-solve__result';
  result.setAttribute('aria-live', 'polite');

  panel.append(controls, hint, result);
  container.append(panel);

  function fail(message: string): void {
    const p = document.createElement('p');
    p.className = 'forge-solve__error';
    p.textContent = message;
    result.replaceChildren(p);
  }

  function renderSolution(steps: readonly AnvilAction[], target: number): void {
    const heading = document.createElement('p');
    heading.className = 'forge-solve__heading';
    heading.textContent = `${en.forge.solveStepsHeading} (${steps.length})`;

    const list = document.createElement('ol');
    list.className = 'forge-steps';
    let work = WORK_START;
    // Runs of the same action before the final, rule-governed steps collapse into one row with a
    // count: "Shrink ×4" reads faster at the anvil than four identical rows. The final steps stay one
    // per row, because their order is what the rules check.
    const freeSteps = Math.max(0, steps.length - FINAL_POSITIONS.length);
    for (let index = 0; index < freeSteps; ) {
      const action = steps[index]!;
      let count = 1;
      while (
        index + count < freeSteps &&
        steps[index + count]!.delta === action.delta &&
        actionLabel(steps[index + count]!) === actionLabel(action)
      ) {
        count++;
      }
      work += action.delta * count;
      const item = document.createElement('li');
      item.className = 'forge-step';
      const name = document.createElement('span');
      name.className = 'forge-step__action';
      name.textContent = count > 1 ? `${actionLabel(action)} ×${count}` : actionLabel(action);
      const delta = document.createElement('span');
      delta.className = 'forge-step__delta';
      const sign = action.delta > 0 ? '+' : '';
      delta.textContent = count > 1 ? `${sign}${action.delta} ×${count} → ${work}` : `${sign}${action.delta} → ${work}`;
      item.append(name, delta);
      list.append(item);
      index += count;
    }
    steps.slice(freeSteps).forEach((action, offset) => {
      const index = freeSteps + offset;
      work += action.delta;
      const item = document.createElement('li');
      item.className = 'forge-step';
      // The final three are the ones the rules govern, so they are marked as such rather than
      // merely coloured (docs/DESIGN.md: structure should encode something true).
      const fromEnd = steps.length - 1 - index;
      if (fromEnd < FINAL_POSITIONS.length) {
        item.dataset.final = 'true';
        const badge = document.createElement('span');
        badge.className = 'forge-step__badge';
        badge.textContent = en.forge.positionNames[FINAL_POSITIONS[fromEnd] as RulePosition];
        item.dataset.badge = 'true';
        const name = document.createElement('span');
        name.className = 'forge-step__action';
        name.textContent = actionLabel(action);
        item.append(name, badge);
      } else {
        const name = document.createElement('span');
        name.className = 'forge-step__action';
        name.textContent = actionLabel(action);
        item.append(name);
      }
      const delta = document.createElement('span');
      delta.className = 'forge-step__delta';
      delta.textContent = `${action.delta > 0 ? '+' : ''}${action.delta} → ${work}`;
      item.append(delta);
      list.append(item);
    });

    const bar = document.createElement('div');
    bar.className = 'forge-workbar';
    const track = document.createElement('div');
    track.className = 'forge-workbar__track';
    const fill = document.createElement('div');
    fill.className = 'forge-workbar__fill';
    fill.style.width = `${(target / WORK_MAX) * 100}%`;
    track.append(fill);
    const caption = document.createElement('div');
    caption.className = 'forge-workbar__caption';
    const left = document.createElement('span');
    left.textContent = String(WORK_MIN);
    const middle = document.createElement('span');
    middle.textContent = `${en.forge.solveTargetLabel} ${target}`;
    const right = document.createElement('span');
    right.textContent = String(WORK_MAX);
    caption.append(left, middle, right);
    bar.append(track, caption);

    result.replaceChildren(heading, list, bar);
  }

  function solveCurrent(): void {
    const read = options.read();
    if (!read.ok) {
      fail(read.error);
      return;
    }
    let target = read.target;
    if (targetInput) {
      const raw = targetInput.value.trim();
      const parsed = Number(raw);
      if (raw === '' || !Number.isInteger(parsed)) {
        fail(en.forge.solveErrorTarget);
        return;
      }
      target = parsed;
    }
    if (target === undefined || target < WORK_MIN || target > WORK_MAX) {
      fail(en.forge.solveErrorTargetRange);
      return;
    }

    const solutions = solve({
      start: WORK_START,
      target,
      rules: read.rules,
      actions: actionsForProfile(options.profile()),
      minValue: WORK_MIN,
      maxValue: WORK_MAX,
      maxSolutions: 1,
    });
    const best = solutions[0];
    if (!best) {
      // Say which of the two things went wrong, because the fix differs. Re-solving without the
      // rules separates them: if that succeeds the rules are the blocker, otherwise the target is
      // simply not reachable inside the bar. Only ever runs on failure, so it costs nothing in the
      // normal case.
      const withoutRules = solve({
        start: WORK_START,
        target,
        rules: [],
        actions: actionsForProfile(options.profile()),
        minValue: WORK_MIN,
        maxValue: WORK_MAX,
        maxSolutions: 1,
      });
      fail(
        withoutRules.length > 0 && read.rules.length > 0
          ? en.forge.solveNoSolutionRules
          : en.forge.solveNoSolutionTarget,
      );
      return;
    }
    renderSolution(best.steps, target);
  }

  button.addEventListener('click', solveCurrent);

  /**
   * Solves only when the inputs are complete and in range, and otherwise stays quiet: typing "4" on
   * the way to "45" must not flash an error. Debounced so each keystroke does not run the solver.
   */
  let pending: ReturnType<typeof setTimeout> | null = null;
  function trySolve(): void {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      const read = options.read();
      if (!read.ok) return;
      let target = read.target;
      if (targetInput) {
        const raw = targetInput.value.trim();
        if (raw === '') {
          result.replaceChildren();
          return;
        }
        const parsed = Number(raw);
        if (!Number.isInteger(parsed)) return;
        target = parsed;
      }
      if (target === undefined || target < WORK_MIN || target > WORK_MAX) return;
      solveCurrent();
    }, 200);
  }
  targetInput?.addEventListener('input', trySolve);

  return {
    element: panel,
    clear(): void {
      result.replaceChildren();
    },
    setTarget(target: number | null): void {
      if (!targetInput) return;
      targetInput.value = target === null ? '' : String(target);
      hint.textContent = target === null ? en.forge.solveTargetHint : en.forge.solveTargetFromSeed;
      if (target === null) result.replaceChildren();
      else trySolve();
    },
    solve: solveCurrent,
    trySolve,
  };
}
