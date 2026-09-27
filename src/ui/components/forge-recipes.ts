// Forging calculator panels (docs/PLAN.md section 14): the custom recipe editor form and the
// saved recipes list, wired together from one mount call so "open" can fill the editor. Plain DOM
// factories in the house style of ./panels — no framework, no hardcoded display text (@ui/i18n/en),
// no colours (theme tokens only). Model + validation + persistence live in @forge/model/custom-recipe;
// this module renders and wires them and owns nothing else.
import { en } from '@ui/i18n/en';
import { PANEL_GLYPHS, createGlyphSvg } from '@ui/icons/glyphs';
import { mountSolvePanel } from './forge-solve';
import { createStorage } from '@platform/storage';
import type { StorageAdapter } from '@platform/storage';
import {
  CUSTOM_RECIPE_MAX_RULES,
  FORM_SLOT_POSITIONS,
  RECIPE_ACTION_TYPES,
  RECIPE_HIT_STRENGTHS,
  createCustomRecipeId,
  loadCustomRecipeStore,
  parseCustomRecipesFile,
  rulesFromForm,
  saveCustomRecipeStore,
  serializeCustomRecipes,
  splitRulesForForm,
} from '@forge/model/custom-recipe';
import type {
  CustomRecipe,
  CustomRecipeField,
  CustomRecipeStore,
  FormRules,
  FormSlotPosition,
} from '@forge/model/custom-recipe';
import type { ActionType, ForgeRule, HitStrength } from '@forge/model/types';
import { actionsForProfile } from '@forge/model/actions';

/** Downloaded export file name (a code constant, not display text). */
const EXPORT_FILE_NAME = 'terrafirma-forge-recipes.json';

/**
 * One rule slot: a row of action buttons whose *position in the list* is the rule's position.
 *
 * The three slots are the last three steps, in order, so slot 1 is `THIRD_LAST` and slot 3 is
 * `LAST`. Across the 278 extracted TFC recipes every rule uses one of those three, so a new recipe
 * needs nothing else, and making the user pick a position from a dropdown was asking them to restate
 * what the row already says. A recipe *saved* before 2026-09-10 can hold more -- an `ANY` or
 * `NOT_LAST` rule, or two rules for one step -- and those are shown read-only under the rows and
 * kept, never dropped (`splitRulesForForm`).
 */
interface RuleRowEls {
  readonly position: FormSlotPosition;
  value(): string;
  set(value: string): void;
}

/** Slot order is the order the steps happen in: first of the final three, then the last. */
const RULE_SLOT_POSITIONS: readonly FormSlotPosition[] = FORM_SLOT_POSITIONS;

type RuleActionValue = ActionType | `HIT:${HitStrength}`;

function ruleActionValue(rule: ForgeRule): RuleActionValue {
  return rule.type === 'HIT' && rule.strength !== undefined ? `HIT:${rule.strength}` : rule.type;
}

function parseRuleAction(value: string): Pick<ForgeRule, 'type' | 'strength'> | null {
  if (value === 'HIT') return { type: 'HIT' };
  if (value.startsWith('HIT:')) {
    const strength = value.slice(4) as HitStrength;
    return RECIPE_HIT_STRENGTHS.includes(strength) ? { type: 'HIT', strength } : null;
  }
  return RECIPE_ACTION_TYPES.includes(value as ActionType) ? { type: value as ActionType } : null;
}

type FormReadErrorKey = 'name' | 'target' | 'rule';

type FormRead =
  | {
      readonly ok: true;
      readonly name: string;
      readonly target: number;
      readonly rules: ForgeRule[];
      readonly notes?: string;
    }
  | { readonly ok: false; readonly errorKey: FormReadErrorKey };

function makeButton(label: string, primary = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'forge-btn forge-btn--primary' : 'forge-btn';
  button.textContent = label;
  return button;
}

export function mountForgeRecipes(
  editorContainer: HTMLElement,
  savedListContainer: HTMLElement,
  options: {
    readonly profile: () => string;
    readonly storage?: StorageAdapter;
  },
): { readonly refreshActionLabels: () => void } {
  const storage = options.storage ?? createStorage();
  let recipes: CustomRecipe[] = [];
  /** Stored entries that did not validate: kept verbatim and written back on every save. */
  let unreadable: CustomRecipeStore['unreadable'] = [];
  let editingId: string | null = null;
  /** The rules of the recipe the form was opened with, so none it cannot show are lost. */
  let opened: FormRules | null = null;
  const persist = (): Promise<void> => saveCustomRecipeStore(storage, { recipes, unreadable });

  // ---------- editor form (built once, updated in place) ----------

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = en.forge.namePlaceholder;

  const targetInput = document.createElement('input');
  targetInput.type = 'number';
  targetInput.step = '1';

  /** Every action a rule can name, in the order the buttons are laid out. */
  const ruleActionChoices: readonly (readonly [string, string])[] = [
    ['HIT', en.forge.anyHitName],
    ...RECIPE_HIT_STRENGTHS.map((strength): readonly [string, string] => [
      'HIT:' + strength,
      en.forge.hitStrengthNames[strength],
    ]),
    ...RECIPE_ACTION_TYPES.filter((type) => type !== 'HIT').map(
      (type): readonly [string, string] => [type, en.forge.actionNames[type]],
    ),
  ];

  /**
   * The work each action moves the bar by, shown on its own button.
   *
   * A player picking the last three steps is choosing numbers, not verbs — "Draw" means nothing
   * until you know it is -15 — and the deltas are per profile, so they are read from the same
   * `actionsForProfile` table the solver uses rather than written into the label strings.
   * "Any hit" gets none: it stands for three different deltas.
   */
  const deltaTags: { readonly value: string; readonly el: HTMLElement }[] = [];

  function deltaFor(value: string): string {
    if (!value.includes(':') && value === 'HIT') return '';
    const actions = actionsForProfile(options.profile());
    const [type, strength] = value.split(':');
    const action = actions.find((a) => a.type === type && (strength === undefined || a.strength === strength));
    if (action === undefined) return '';
    return action.delta > 0 ? `+${action.delta}` : String(action.delta);
  }

  function deltaTag(value: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'forge-action-btn__delta';
    el.textContent = deltaFor(value);
    deltaTags.push({ value, el });
    return el;
  }

  /** Re-read the deltas after a profile switch, since the two catalogues can differ. */
  function refreshActionLabels(): void {
    for (const { value, el } of deltaTags) el.textContent = deltaFor(value);
  }

  const ruleRows: RuleRowEls[] = [];
  const ruleRowElements: HTMLElement[] = [];
  for (let i = 0; i < CUSTOM_RECIPE_MAX_RULES; i++) {
    const position: FormSlotPosition = RULE_SLOT_POSITIONS[i] ?? 'LAST';
    const row = document.createElement('div');
    row.className = 'forge-rule-row';

    const badge = document.createElement('span');
    badge.className = 'forge-rule-row__step';
    badge.textContent = String(i + 1);
    badge.title = en.forge.positionNames[position];
    row.append(badge);

    const group = document.createElement('div');
    group.className = 'forge-rule-row__actions';
    const buttons = new Map<string, HTMLButtonElement>();
    let selected = '';

    const apply = (next: string): void => {
      selected = next;
      for (const [value, button] of buttons) {
        button.setAttribute('aria-pressed', value === next ? 'true' : 'false');
      }
    };

      for (const [value, label] of ruleActionChoices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'forge-action-btn';
      button.append(document.createTextNode(label), deltaTag(value));
      button.setAttribute('aria-pressed', 'false');
      // Pressing the selected action again clears the slot, so "no rule here" needs no extra
      // control -- the same arm/disarm gesture the waypoint icon picker uses.
      button.addEventListener('click', () => {
        apply(selected === value ? '' : value);
        // The editor answers as soon as it has everything it needs; no Solve click required.
        solveWhenReady();
      });
      buttons.set(value, button);
      group.append(button);
    }

    row.append(group);
    ruleRows.push({ position, value: () => selected, set: apply });
    ruleRowElements.push(row);
  }

  const saveButton = makeButton(en.forge.saveButton, true);
  const newButton = makeButton(en.forge.newButton);
  const editorStatus = document.createElement('p');
  editorStatus.className = 'forge-status';
  editorStatus.setAttribute('aria-live', 'polite');

  const nameField = document.createElement('div');
  nameField.className = 'forge-field forge-field--name';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'field-label';
  nameLabel.append(document.createTextNode(en.forge.nameLabel), nameInput);
  nameField.append(nameLabel);

  const targetField = document.createElement('div');
  targetField.className = 'forge-field forge-field--target';
  const targetLabel = document.createElement('label');
  targetLabel.className = 'field-label';
  targetLabel.append(document.createTextNode(en.forge.targetLabel), targetInput);
  targetField.append(targetLabel);

  const rulesBlock = document.createElement('div');
  rulesBlock.className = 'forge-rules';
  const rulesHeading = document.createElement('span');
  rulesHeading.className = 'forge-subheading';
  rulesHeading.textContent = en.forge.rulesHeading;
  const rulesHint = document.createElement('p');
  rulesHint.className = 'forge-hint';
  rulesHint.textContent = en.forge.rulesHint;
  const ruleGrid = document.createElement('div');
  ruleGrid.className = 'forge-rule-grid';
  ruleGrid.append(...ruleRowElements);
  /** Rules of an opened recipe that the three rows cannot express: shown, kept, used, not editable. */
  const extraRules = document.createElement('div');
  extraRules.className = 'forge-rules-extra';
  extraRules.hidden = true;
  rulesBlock.append(rulesHeading, rulesHint, ruleGrid, extraRules);

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'forge-form__buttons';
  buttonsRow.append(saveButton, newButton);

  const editorHeading = document.createElement('h3');
  editorHeading.append(
    createGlyphSvg(PANEL_GLYPHS.customRecipe, 'forge-heading__icon'),
    document.createTextNode(en.forge.editorHeading),
  );

  const form = document.createElement('div');
  form.className = 'forge-form';
  form.append(nameField, targetField, rulesBlock, buttonsRow);

  editorContainer.replaceChildren(editorHeading, form, editorStatus);

  /**
   * Solving needs no save: the panel reads whatever is currently in the form (docs/PLAN.md 10c P2).
   * It deliberately does not require a name -- a name is for keeping a recipe, not for answering
   * the question -- so it validates the target and the rules only.
   */
  const solvePanel = mountSolvePanel(rulesBlock, {
    profile: options.profile,
    ownTargetField: false,
    read: () => {
      const targetRaw = targetInput.value;
      const target = Number(targetRaw);
      if (targetRaw.trim() === '' || !Number.isInteger(target))
        return { ok: false, error: en.forge.formErrorTarget };
      const rules = formRules();
      if (rules === null) return { ok: false, error: en.forge.formErrorRule };
      // Solved with every stored rule, including the ones the rows cannot show.
      return { ok: true, rules, target };
    },
  });

  targetInput.addEventListener('input', solveWhenReady);

  /** Hoisted so the rule buttons above, built before the panel exists, can call it. */
  function solveWhenReady(): void {
    solvePanel.trySolve();
  }

  // ---------- saved list (shell built once, the <ul> rebuilt on change) ----------

  const exportButton = makeButton(en.forge.exportButton);
  const importButton = makeButton(en.forge.importButton);
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const listStatus = document.createElement('p');
  listStatus.className = 'forge-status';
  listStatus.setAttribute('aria-live', 'polite');

  const importNote = document.createElement('p');
  importNote.className = 'forge-hint';
  importNote.textContent = en.forge.importNote;

  const recipeList = document.createElement('ul');
  recipeList.className = 'forge-recipe-list';

  const listHeading = document.createElement('h3');
  listHeading.append(
    createGlyphSvg(PANEL_GLYPHS.savedRecipes, 'forge-heading__icon'),
    document.createTextNode(en.forge.listHeading),
  );

  const toolbar = document.createElement('div');
  toolbar.className = 'forge-list-toolbar';
  toolbar.append(exportButton, importButton, fileInput);

  savedListContainer.replaceChildren(listHeading, toolbar, importNote, listStatus, recipeList);

  // ---------- shared state helpers ----------

  function setEditing(id: string | null): void {
    editingId = id;
    saveButton.textContent = id === null ? en.forge.saveButton : en.forge.updateButton;
  }

  function clearFormFields(): void {
    nameInput.value = '';
    targetInput.value = '';
    for (const row of ruleRows) row.set('');
    opened = null;
    showExtraRules([]);
  }

  /**
   * The rules the form stands for: the three rows, merged into the opened recipe's own list so an
   * `ANY`, a `NOT_LAST` or a second rule for one step survives (`rulesFromForm`). Null when a row
   * holds something unreadable.
   */
  function formRules(): ForgeRule[] | null {
    const now: Record<FormSlotPosition, ForgeRule | null> = { THIRD_LAST: null, SECOND_LAST: null, LAST: null };
    for (const row of ruleRows) {
      const action = row.value();
      if (action === '') continue; // an unselected slot is "no rule at this step"
      const parsedAction = parseRuleAction(action);
      if (parsedAction === null) return null;
      now[row.position] = { ...parsedAction, position: row.position };
    }
    return rulesFromForm(opened, now);
  }

  function showExtraRules(extra: readonly ForgeRule[]): void {
    extraRules.replaceChildren();
    extraRules.hidden = extra.length === 0;
    if (extra.length === 0) return;
    const note = document.createElement('p');
    note.className = 'forge-hint';
    note.textContent = en.forge.rulesExtraNote;
    const list = document.createElement('ul');
    list.className = 'forge-rules-extra__list';
    for (const rule of extra) {
      const item = document.createElement('li');
      item.textContent = describeRule(rule);
      list.append(item);
    }
    extraRules.append(note, list);
  }

  function fillForm(recipe: CustomRecipe): void {
    clearFormFields();
    nameInput.value = recipe.name;
    targetInput.value = String(recipe.target);
    // Rules carry their own position, so a saved recipe lands in the slot it belongs to rather
    // than in whatever order it happened to be written; what no slot can hold is listed apart.
    opened = splitRulesForForm(recipe.rules);
    for (const row of ruleRows) {
      const rule = opened.slots[row.position];
      row.set(rule === null ? '' : ruleActionValue(rule));
    }
    showExtraRules(opened.extra);
  }

  function setEditorStatus(text: string, isError = false): void {
    editorStatus.textContent = text;
    editorStatus.classList.toggle('forge-status--error', isError);
  }

  function setListStatus(text: string, isError = false): void {
    listStatus.textContent = text;
    listStatus.classList.toggle('forge-status--error', isError);
  }

  const FORM_ERROR_TEXTS: Record<FormReadErrorKey, string> = {
    name: en.forge.formErrorName,
    target: en.forge.formErrorTarget,
    rule: en.forge.formErrorRule,
  };

  function readForm(): FormRead {
    const name = nameInput.value.trim();
    if (name === '') return { ok: false, errorKey: 'name' };
    const targetRaw = targetInput.value;
    const target = Number(targetRaw);
    // Whole numbers only (TFC work values), and an empty field must not read as 0.
    if (targetRaw.trim() === '' || !Number.isInteger(target))
      return { ok: false, errorKey: 'target' };
    const rules = formRules();
    if (rules === null) return { ok: false, errorKey: 'rule' };
    return { ok: true, name, target, rules };
  }

  function makeRecipe(id: string, read: Extract<FormRead, { ok: true }>): CustomRecipe {
    // An update keeps what the form does not edit -- the notes and the profile -- instead of
    // quietly dropping them. A new recipe records the profile it was made in.
    const before = recipes.find((r) => r.id === id);
    const notes = before?.notes;
    const profile = before === undefined ? options.profile() : before.profile;
    return {
      id,
      name: read.name,
      target: read.target,
      rules: [...read.rules],
      ...(notes !== undefined ? { notes } : {}),
      ...(profile !== undefined ? { profile } : {}),
    };
  }

  function renderList(): void {
    recipeList.replaceChildren();
    if (recipes.length === 0) {
      // An <li>, not a <p>: the message lives inside the <ul>, and only list items belong there.
      const empty = document.createElement('li');
      empty.className = 'forge-list__empty';
      empty.textContent = en.forge.listEmpty;
      recipeList.append(empty);
      return;
    }
    for (const recipe of recipes) {
      const item = document.createElement('li');
      item.className = 'forge-recipe-item';

      const info = document.createElement('div');
      info.className = 'forge-recipe-item__info';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'forge-recipe-item__name';
      nameSpan.textContent = recipe.name;
      const metaSpan = document.createElement('span');
      metaSpan.className = 'forge-recipe-item__meta';
      metaSpan.textContent = describeRecipe(recipe);
      info.append(nameSpan, metaSpan);

      const actions = document.createElement('div');
      actions.className = 'forge-recipe-item__actions';
      const openButton = makeButton(en.forge.openButton);
      const editButton = makeButton(en.forge.editButton);
      const deleteButton = makeButton(en.forge.deleteButton);
      openButton.addEventListener('click', () => openInEditor(recipe, false));
      editButton.addEventListener('click', () => openInEditor(recipe, true));
      deleteButton.addEventListener('click', () => handleDelete(recipe.id));
      actions.append(openButton, editButton, deleteButton);

      item.append(info, actions);
      recipeList.append(item);
    }
  }

  function describeRule(rule: ForgeRule): string {
    const actionName =
      rule.type === 'HIT'
        ? rule.strength === undefined
          ? en.forge.anyHitName
          : en.forge.hitStrengthNames[rule.strength]
        : en.forge.actionNames[rule.type];
    return `${actionName} · ${en.forge.positionNames[rule.position]}`;
  }

  function describeRecipe(recipe: CustomRecipe): string {
    const parts = [`${en.forge.metaTargetLabel} ${recipe.target}`];
    if (recipe.rules.length === 0) parts.push(en.forge.noRulesText);
    else for (const rule of recipe.rules) parts.push(describeRule(rule));
    return parts.join(' · ');
  }

  function openInEditor(recipe: CustomRecipe, focusName: boolean): void {
    fillForm(recipe);
    setEditing(recipe.id);
    setEditorStatus('');
    editorContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    solvePanel.solve();
    if (focusName) nameInput.focus();
  }

  // ---------- actions ----------

  function handleSave(): void {
    const read = readForm();
    if (!read.ok) {
      setEditorStatus(FORM_ERROR_TEXTS[read.errorKey], true);
      return;
    }
    const isUpdate = editingId !== null;
    if (isUpdate) {
      recipes = recipes.map((r) => (r.id === editingId ? makeRecipe(editingId, read) : r));
    } else {
      const id = createCustomRecipeId();
      recipes = [...recipes, makeRecipe(id, read)];
      setEditing(id); // stay in edit mode so the next Save updates instead of duplicating
    }
    renderList();
    void persist().catch(() => {
      setEditorStatus(en.forge.statusStoreFailed, true);
    });
    setEditorStatus(isUpdate ? en.forge.statusUpdated : en.forge.statusSaved);
  }

  function handleNew(): void {
    clearFormFields();
    setEditing(null);
    setEditorStatus('');
    nameInput.focus();
  }

  function handleDelete(id: string): void {
    recipes = recipes.filter((r) => r.id !== id);
    if (editingId === id) {
      // The edited recipe is gone — leave edit mode, or Save would resurrect it under the same id.
      clearFormFields();
      setEditing(null);
    }
    renderList();
    void persist().catch(() => {
      setListStatus(en.forge.statusStoreFailed, true);
    });
    setListStatus(en.forge.statusDeleted);
  }

  function handleExport(): void {
    const blob = new Blob([serializeCustomRecipes(recipes)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = EXPORT_FILE_NAME;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoked after the click has had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setListStatus(en.forge.statusExported);
  }

  const IMPORT_FIELD_TEXTS: Record<CustomRecipeField, string> = {
    entry: en.forge.importFieldEntry,
    id: en.forge.importFieldId,
    name: en.forge.importFieldName,
    target: en.forge.importFieldTarget,
    rules: en.forge.importFieldRules,
    notes: en.forge.importFieldNotes,
    profile: en.forge.importFieldProfile,
  };

  function importFailureMessage(
    failure: Extract<ReturnType<typeof parseCustomRecipesFile>, { ok: false }>['failure'],
  ): string {
    switch (failure.kind) {
      case 'invalid-json':
        return en.forge.importInvalidJson;
      case 'wrong-shape':
        return en.forge.importWrongShape;
      case 'bad-recipe':
        return `${en.forge.importBadPrefix} ${failure.index + 1}: ${IMPORT_FIELD_TEXTS[failure.field]}`;
    }
  }

  function handleImportText(text: string): void {
    const result = parseCustomRecipesFile(text);
    if (!result.ok) {
      // Rejected as a whole — `recipes` and storage are left exactly as they were.
      setListStatus(importFailureMessage(result.failure), true);
      return;
    }
    recipes = [...result.recipes];
    renderList();
    const stillExists = editingId !== null && result.recipes.some((r) => r.id === editingId);
    if (!stillExists) {
      clearFormFields();
      setEditing(null);
    }
    void persist().catch(() => {
      setListStatus(en.forge.statusStoreFailed, true);
    });
    setListStatus(en.forge.statusImported);
  }

  // ---------- wiring ----------

  saveButton.addEventListener('click', handleSave);
  newButton.addEventListener('click', handleNew);
  exportButton.addEventListener('click', handleExport);
  importButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // allow re-selecting the same file again
    if (file === undefined) return;
    void file
      .text()
      .then(handleImportText)
      .catch(() => setListStatus(en.forge.importReadFailed, true));
  });

  void loadCustomRecipeStore(storage).then((loaded) => {
    recipes = loaded.recipes;
    unreadable = loaded.unreadable;
    renderList();
    // Said, not swallowed: these are kept in storage exactly as they were.
    if (unreadable.length > 0) setListStatus(`${unreadable.length} ${en.forge.unreadableKept}`, true);
  });

  return { refreshActionLabels };
}
