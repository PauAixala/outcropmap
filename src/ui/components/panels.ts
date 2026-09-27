// Map UI panels: seed input, profile/dimension selects, layer toggles, legend, scale bar and the
// cursor hover readout. Plain DOM factories (ADR 0003) — no framework, no hardcoded display text.
import { en } from '@ui/i18n/en';
import { STRUCTURE_KINDS, structureKindFor, structureSetOf } from '@ui/icons/structure-glyphs';
import { formatBiomeName, formatMaterialName, formatOreName } from '@ui/i18n/ore-names';
import { categoricalColor, hashString } from '@render/colormap';
import { seasonalTemperatureRange } from '@app/growth';

/** TFC's default `temperatureScale` (`src/worldgen/tfc-1.20/index.ts`'s settings descriptor). */
const DEFAULT_TEMPERATURE_SCALE = 20_000;
import { LAYER_IDS } from '@worldgen/api/types';
import type { DepositFeature, DimensionId, Probe, ProfileId, StructureFeature, ProfileDescriptor } from '@worldgen/api/types';
import { listProfiles } from '@worldgen/registry';
import { blocksPerPixel } from '@core/coords/coords';
import {
  DEFAULT_MAP_FILTER,
  getRasterLayer,
  resolveLayerOpacity,
  selectAllIds,
  selectNoneIds,
} from '@layers/index';
import type { MapFilter, RockMatchMode } from '@layers/index';
import { colorToCss } from '@render/colormap';
import { oreMarkerColor } from '@render/markers';
import { getThemeTokens } from '@ui/theme/theme';
import { createStorage } from '@platform/storage';
import type { StorageAdapter } from '@platform/storage';
import type { Store } from '@app/state';
import type { MapState } from '@app/state';
import { PANEL_GLYPHS, createGlyphSvg } from '@ui/icons/glyphs';
import { RELIABILITY_MIN_SAMPLE, UNRELIABLE_PRECISION } from '@worldgen/api/types';

function parseSeed(text: string): bigint | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0n;
  // Numeric only for Phase 1 — an arbitrary string seed would need Java's string hashCode, which
  // is a real worldgen port (AGENTS.md section 2), not a UI convenience to invent here.
  if (!/^-?\d+$/.test(trimmed)) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

export function mountSeedInput(container: HTMLElement, store: Store<MapState>): void {
  container.replaceChildren();
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(document.createTextNode(en.seed.label));

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = en.seed.placeholder;
  input.value = store.getState().seed.toString();
  input.addEventListener('change', () => {
    const parsed = parseSeed(input.value);
    if (parsed !== null) store.setState({ seed: parsed });
    else input.value = store.getState().seed.toString();
  });
  label.append(input);
  container.append(label);

  store.subscribe((state) => {
    if (document.activeElement !== input && input.value !== state.seed.toString()) {
      input.value = state.seed.toString();
    }
  });
}

export function mountProfileSelect(container: HTMLElement, store: Store<MapState>): void {
  container.replaceChildren();
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(document.createTextNode(en.profile.label));

  const select = document.createElement('select');
  for (const descriptor of listProfiles()) {
    const option = document.createElement('option');
    option.value = descriptor.id;
    option.textContent = en.profileNames[descriptor.id] ?? descriptor.label;
    select.append(option);
  }
  select.value = store.getState().profile;
  select.addEventListener('change', () => {
    store.setState({ profile: select.value as ProfileId });
  });
  label.append(select);
  container.append(label);

  store.subscribe((state) => {
    if (select.value !== state.profile) select.value = state.profile;
  });
}

export function mountDimensionSelect(container: HTMLElement, store: Store<MapState>): void {
  container.replaceChildren();
  const label = document.createElement('label');
  label.className = 'field-label';
  label.append(document.createTextNode(en.dimension.label));
  const select = document.createElement('select');
  label.append(select);
  container.append(label);

  let lastProfile: ProfileId | null = null;
  function sync(): void {
    const state = store.getState();
    if (state.profile !== lastProfile) {
      lastProfile = state.profile;
      const descriptor = listProfiles().find((p) => p.id === state.profile);
      const dims = descriptor?.dimensions ?? ['overworld'];
      select.replaceChildren();
      for (const dim of dims) {
        const option = document.createElement('option');
        option.value = dim;
        option.textContent = en.dimensionNames[dim] ?? dim;
        select.append(option);
      }
    }
    if (select.value !== state.dimension) select.value = state.dimension;
  }

  select.addEventListener('change', () => {
    store.setState({ dimension: select.value as DimensionId });
  });
  sync();
  store.subscribe(sync);
}

/** Shown for a value the active profile cannot produce yet — never a fabricated number. */
const NO_VALUE = '—';

/**
 * Persisted open/closed state of the "Advanced world settings" disclosure ("most users will never
 * touch it"). Exported as plain functions taking
 * a `StorageAdapter` -- rather than reaching for `createStorage()` internally -- so the round trip
 * is unit-testable without a DOM or a real storage backend (`tests/unit/world-settings.test.ts`).
 */
export const WORLD_SETTINGS_DISCLOSURE_KEY = 'worldSettingsOpen';

export async function loadWorldSettingsOpen(storage: StorageAdapter): Promise<boolean> {
  return (await storage.get<boolean>(WORLD_SETTINGS_DISCLOSURE_KEY)) === true;
}

export function saveWorldSettingsOpen(storage: StorageAdapter, open: boolean): Promise<void> {
  return storage.set(WORLD_SETTINGS_DISCLOSURE_KEY, open);
}

let worldSettingsStorage: StorageAdapter | null = null;
function getWorldSettingsStorage(): StorageAdapter {
  worldSettingsStorage ??= createStorage();
  return worldSettingsStorage;
}

/** `20000` -> `"20,000"`. Plain grouping only -- these are whole-block distances or small
 * fractions, never currency or anything else that would need a real i18n number formatter. */
function formatSettingNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Numeric world-generation settings declared by the active profile (ProfileDescriptor.settings).
 * A profile that declares none renders nothing. Everything else renders behind a collapsed
 * "Advanced world settings" disclosure (FEEDBACK.md section 4) -- these are TFC's own world-preset
 * fields (`net.dries007.tfc.world.settings.Settings`), meaningless to a player who has never read
 * that Java record, so each row gets a human label, its unit, the real default and a one-line
 * "what changes on the map" explanation (`en.worldSettingNames` / `Units` / `Descriptions`,
 * confirmed against `$HOME/reference/tfc` -- see `docs/WORLDGEN-NOTES.md`'s "World preset settings"
 * section for the citations). The open/closed state of the disclosure round-trips through
 * `@platform/storage` so it stays out of the way on every later visit once a user has seen it.
 */
export function mountWorldSettings(container: HTMLElement, store: Store<MapState>): void {
  let lastSignature = '';
  let disclosureOpen = false;

  void loadWorldSettingsOpen(getWorldSettingsStorage()).then((open) => {
    disclosureOpen = open;
    lastSignature = ''; // force one re-render so the persisted state is actually applied
    render();
  });

  function render(): void {
    const state = store.getState();
    const descriptor = listProfiles().find((p) => p.id === state.profile);
    const settings = descriptor?.settings ?? [];
    const signature = `${state.profile}|${disclosureOpen}|${settings.map((s) => `${s.id}=${state.settings[s.id]}`).join(',')}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    container.replaceChildren();
    if (settings.length === 0) {
      container.hidden = true;
      return;
    }
    container.hidden = false;

    const details = document.createElement('details');
    details.className = 'world-settings';
    details.open = disclosureOpen;
    details.addEventListener('toggle', () => {
      disclosureOpen = details.open;
      void saveWorldSettingsOpen(getWorldSettingsStorage(), disclosureOpen);
    });

    const summary = document.createElement('summary');
    summary.append(
      createGlyphSvg(PANEL_GLYPHS.settings, 'panel-section__icon'),
      document.createTextNode(en.worldSettings.heading),
    );
    details.append(summary);

    for (const setting of settings) {
      const row = document.createElement('div');
      row.className = 'setting-row';

      const head = document.createElement('div');
      head.className = 'setting-row__head';
      const label = document.createElement('label');
      label.className = 'setting-row__label';
      label.htmlFor = `setting-${setting.id}`;
      label.textContent = en.worldSettingNames[setting.id] ?? setting.id;
      const unit = document.createElement('span');
      unit.className = 'setting-row__unit';
      unit.textContent = en.worldSettingUnits[setting.id] ?? '';
      head.append(label, unit);

      const input = document.createElement('input');
      input.id = `setting-${setting.id}`;
      input.type = 'number';
      input.min = String(setting.min);
      input.max = String(setting.max);
      input.step = String(setting.step);
      input.value = String(state.settings[setting.id] ?? setting.defaultValue);
      input.addEventListener('change', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        store.setState({ settings: { ...store.getState().settings, [setting.id]: value } });
      });

      const hint = document.createElement('p');
      hint.className = 'setting-row__hint';
      const description = en.worldSettingDescriptions[setting.id];
      const defaultText = `${en.worldSettings.defaultLabel}: ${formatSettingNumber(setting.defaultValue)}${
        en.worldSettingUnits[setting.id] ? ` ${en.worldSettingUnits[setting.id]}` : ''
      }`;
      hint.textContent = description ? `${description} ${defaultText}.` : `${defaultText}.`;

      row.append(head, input, hint);
      details.append(row);
    }

    container.append(details);
  }

  render();
  store.subscribe(render);
}

/** Opacity slider step: whole percentage points are plenty precise for a visual wash. */
const OPACITY_STEP = 0.01;

/**
 * Any combination of layers may be enabled at once (docs/adr/0007-layer-compositing.md) --
 * checking a layer no longer un-checks the others. Each raster layer also gets an opacity slider
 * next to its checkbox; `grid` has no opacity concept of its own (it is drawn separately, always
 * last, at fixed alphas baked into its own line colours) so it gets a checkbox only.
 */
export function mountLayerPanel(container: HTMLElement, store: Store<MapState>): void {
  let lastSignature = '';

  function render(): void {
    const state = store.getState();
    const descriptor = listProfiles().find((p) => p.id === state.profile);
    const available = descriptor?.layers ?? LAYER_IDS;
    const opacitySignature = available
      .map((id) => `${id}=${resolveLayerOpacity(id, state.layerOpacity)}`)
      .join(',');
    const signature = `${state.profile}|${available.join(',')}|${state.enabledLayers.join(',')}|${opacitySignature}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    container.replaceChildren();
    const developer = document.createElement('details');
    const developerHeading = document.createElement('summary');
    developerHeading.textContent = en.layers.developer;
    developer.append(developerHeading);
    developer.open = true;

    for (const layerId of available) {
      const row = document.createElement('div');
      row.className = 'layer-row';

      const label = document.createElement('label');
      label.className = 'layer-row__toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.enabledLayers.includes(layerId);
      checkbox.addEventListener('change', () => {
        const current = store.getState().enabledLayers;
        const next = checkbox.checked
          ? [...current, layerId]
          : current.filter((id) => id !== layerId);
        store.setState({ enabledLayers: next });
      });
      label.append(checkbox, document.createTextNode(en.layerNames[layerId] ?? layerId));
      row.append(label);

      const raster = getRasterLayer(layerId);
      // Opacity only for layers that are on: a slider next to a layer you cannot see changes
      // nothing visible, and ten of them made the panel read as a mixing desk.
      if (raster && checkbox.checked) {
        const opacity = document.createElement('input');
        opacity.type = 'range';
        opacity.className = 'layer-row__opacity';
        opacity.min = '0';
        opacity.max = '1';
        opacity.step = String(OPACITY_STEP);
        opacity.value = String(resolveLayerOpacity(layerId, store.getState().layerOpacity));
        opacity.title = en.layers.opacity;
        opacity.setAttribute(
          'aria-label',
          `${en.layerNames[layerId] ?? layerId} ${en.layers.opacity}`,
        );
        opacity.addEventListener('change', () => {
          const value = Number(opacity.value);
          if (!Number.isFinite(value)) return;
          store.setState({ layerOpacity: { ...store.getState().layerOpacity, [layerId]: value } });
        });
        row.append(opacity);
      }

      if (raster?.developer) developer.append(row);
      else container.append(row);
    }
    if (developer.childElementCount > 1) container.append(developer);
  }

  render();
  store.subscribe(render);
}

/**
 * A number input bound to one nullable numeric field of `MapFilter` (a min or a max). Empty means
 * "unset" -- `onChange(null)` -- rather than 0, which would be a real, very cold/dry value.
 * Invalid, non-numeric text is rejected and the field snaps back to the last good value, the same
 * recovery `mountWorldSettings` and `mountSeedInput` use elsewhere in this file.
 *
 * Returns the element itself (not just appending it) so the caller can later push a state value
 * into it in place -- see `mountFilterPanel`'s `syncNumberInput`, which never recreates this node,
 * so a value pushed in from outside never fights with whatever the user is mid-typing (guarded by
 * `document.activeElement`) and never disturbs scroll position or focus elsewhere in the panel.
 */
function createNullableNumberInput(
  placeholder: string,
  value: number | null,
  onChange: (value: number | null) => void,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.placeholder = placeholder;
  input.value = value === null ? '' : String(value);
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '') {
      onChange(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      input.value = value === null ? '' : String(value);
      return;
    }
    onChange(parsed);
  });
  return input;
}

/** Pushes a `MapFilter` numeric field's current value into an input built by
 * `createNullableNumberInput`, without disturbing a value the user is actively typing (same
 * `document.activeElement` guard `mountSeedInput`/`mountProfileSelect` use above). */
function syncNumberInput(input: HTMLInputElement, value: number | null): void {
  const text = value === null ? '' : String(value);
  if (document.activeElement !== input && input.value !== text) input.value = text;
}

/** One "<heading> / min input / max input" row, shared by the temperature and rainfall criteria.
 * Built once by `mountFilterPanel` (not per render) -- returns the row plus both inputs so the
 * caller can push value updates into them in place via `syncNumberInput`. */
function buildFilterRangeRow(
  heading: string,
  min: number | null,
  max: number | null,
  minPlaceholder: string,
  maxPlaceholder: string,
  onMin: (value: number | null) => void,
  onMax: (value: number | null) => void,
): { row: HTMLElement; minInput: HTMLInputElement; maxInput: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'filter-range-row';

  const label = document.createElement('p');
  label.className = 'filter-subheading';
  label.textContent = heading;
  row.append(label);

  const inputs = document.createElement('div');
  inputs.className = 'filter-range-row__inputs';
  const minInput = createNullableNumberInput(minPlaceholder, min, onMin);
  const maxInput = createNullableNumberInput(maxPlaceholder, max, onMax);
  inputs.append(minInput, maxInput);
  row.append(inputs);
  return { row, minInput, maxInput };
}

/** One entry tracked by `syncChecklist`: the `<li>` so it can be dropped from the DOM, and the
 * checkbox so its `checked` state can be updated without touching anything else. */
interface ChecklistEntry {
  readonly li: HTMLLIElement;
  readonly checkbox: HTMLInputElement;
}

/**
 * Keeps a `<ul class="filter-checklist">` in sync with a multi-select criterion (rock ids, biome
 * ids) *in place* -- this is the fix for docs/FEEDBACK.md's "toggling a rock checkbox scrolls the
 * list back to the top": the previous implementation tore down and rebuilt the entire filter panel
 * on every single checkbox change, which threw away the list's scroll position and the checkbox's
 * own keyboard focus along with it.
 *
 * `ids` (the full set of selectable ids for the active profile) only ever changes on a profile
 * switch, so that is the only time this rebuilds the `<li>` elements from scratch -- cheap to do
 * and there is no scroll position worth preserving across a profile change anyway. On every other
 * call (the common case: one checkbox toggled, or a "select all"/"select none" click) the existing
 * `<li>`/`<input>` nodes are reused untouched and only their `checked` property is updated, so the
 * list's `scrollTop` and the browser's focused element both survive exactly as the DOM leaves them.
 */
function syncChecklist(
  list: HTMLUListElement,
  entries: Map<string, ChecklistEntry>,
  idsCache: { current: string },
  ids: readonly string[],
  selected: readonly string[],
  labelFor: (id: string) => string,
  onToggle: (id: string, checked: boolean) => void,
  colorForId?: (id: string) => number,
  /** Optional hover text, e.g. what a vein actually yields. */
  titleFor?: (id: string) => string,
  /** Optional second line under the name, in smaller muted text (an ore's yields). */
  detailFor?: (id: string) => string,
): void {
  const idsKey = ids.join(',');
  if (idsKey !== idsCache.current) {
    idsCache.current = idsKey;
    list.replaceChildren();
    entries.clear();
    for (const id of ids) {
      const li = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.addEventListener('change', () => onToggle(id, checkbox.checked));
      label.append(checkbox);
      if (colorForId) {
        const swatch = document.createElement('span');
        swatch.className = 'ore-swatch';
        swatch.style.background = colorToCss(colorForId(id));
        label.append(swatch);
      }
      const name = labelFor(id);
      const detail = detailFor?.(id) ?? '';
      const text = document.createElement('span');
      text.className = 'filter-checklist__text';
      const nameEl = document.createElement('span');
      nameEl.className = 'filter-checklist__name';
      nameEl.textContent = name;
      text.append(nameEl);
      if (detail !== '') {
        const detailEl = document.createElement('span');
        detailEl.className = 'filter-checklist__detail';
        detailEl.textContent = detail;
        text.append(detailEl);
      }
      label.append(text);
      // Rows clip to one line each, so hovering has to give the whole text back.
      const title = titleFor?.(id) ?? (detail === '' ? name : `${name} · ${detail}`);
      if (title !== '') label.title = title;
      li.append(label);
      list.append(li);
      entries.set(id, { li, checkbox });
    }
  }
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) continue;
    const checked = selected.includes(id);
    if (entry.checkbox.checked !== checked) entry.checkbox.checked = checked;
  }
}

/** One "<subheading> + Select all + Select none" row, shared by the rock and biome sections. */
function buildChecklistHead(onSelectAll: () => void, onSelectNone: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'filter-section-head';

  const selectAllButton = document.createElement('button');
  selectAllButton.type = 'button';
  selectAllButton.className = 'filter-select-btn';
  selectAllButton.textContent = en.filter.selectAll;
  selectAllButton.addEventListener('click', onSelectAll);

  const selectNoneButton = document.createElement('button');
  selectNoneButton.type = 'button';
  selectNoneButton.className = 'filter-select-btn';
  selectNoneButton.textContent = en.filter.selectNone;
  selectNoneButton.addEventListener('click', onSelectNone);

  head.append(selectAllButton, selectNoneButton);
  return head;
}

function buildFilterDisclosure(
  storage: StorageAdapter,
  key: string,
  title: string,
): { readonly details: HTMLDetailsElement; readonly body: HTMLDivElement } {
  const details = document.createElement('details');
  details.className = 'filter-section';
  details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'filter-subheading';
  summary.textContent = title;
  const body = document.createElement('div');
  body.className = 'filter-section__body';
  details.append(summary, body);
  const storageKey = `filter-open:${key}`;
  void storage.get<boolean>(storageKey).then((stored) => {
    if (typeof stored === 'boolean') details.open = stored;
  });
  details.addEventListener('toggle', () => {
    void storage.set(storageKey, details.open);
  });
  return { details, body };
}

/**
 * "Highlights matching terrain, dims everything else" (docs/FEEDBACK.md, Pau's request): rock
 * (multi-select, top-layer-only or any-layer-in-the-stack), biome (multi-select), temperature and
 * rainfall min/max, all optional and combined with AND (`@layers/filter`'s `matchesFilter`). Ore is
 * deliberately absent as a working control -- deposits are Phase 6 (HANDOFF.md item 6) and do not
 * exist yet, so it is shown disabled with a note instead of silently dropped or faked.
 *
 * Rock ids come from `profile.rockPalette` and biome ids from `profile.biomePalette` (the same
 * sources the rock and biome layers paint from, which is why each row carries its colour) rather than importing `src/data/tfc-1.20/{rocks,biomes}
 * .json` directly -- those palettes *are* the ported list of registry ids for the active profile
 * (see each file's own header comment), and staying profile-scoped means this panel does something
 * sane for a profile with a different rock/biome set instead of hardcoding one version's list.
 * Each list gets its own "select all" / "select none" pair next to its heading -- both go through
 * `setFilter`, the exact same state path a single checkbox click uses (`@layers/filter`'s
 * `selectAllIds`/`selectNoneIds`).
 *
 * Renders once at mount time and thereafter updates the *existing* DOM in place on every state
 * change (`syncChecklist`, `syncNumberInput`) rather than tearing the panel down and rebuilding it
 * -- see `syncChecklist`'s doc comment for why that matters for scroll position and keyboard focus.
 *
 * Actually enabling the dim on the map is the `filter` raster layer's own checkbox in the Layers
 * panel above (`mountLayerPanel` already gives every raster layer, `filter` included, a checkbox
 * and opacity slider) -- this section only edits the criteria `MapState.filter` holds.
 */
export function mountFilterPanel(container: HTMLElement, store: Store<MapState>): void {
  const storage = createStorage();
  function setFilter(patch: Partial<MapFilter>): void {
    store.setState({ filter: { ...store.getState().filter, ...patch } });
  }

  container.replaceChildren();

  const intro = document.createElement('p');
  intro.className = 'filter-intro';
  intro.textContent = en.filter.intro;
  container.append(intro);

  // --- Rock ---
  const rockDisclosure = buildFilterDisclosure(storage, 'rock', en.filter.rockHeading);
  const rockSection = rockDisclosure.details;
  const rockBody = rockDisclosure.body;
  let rockIdsForButtons: readonly string[] = [];
  rockBody.append(
    buildChecklistHead(
      () => setFilter({ rocks: selectAllIds(rockIdsForButtons) }),
      () => setFilter({ rocks: selectNoneIds() }),
    ),
  );
  const rockList = document.createElement('ul');
  rockList.className = 'filter-checklist';
  rockBody.append(rockList);
  const rockEntries = new Map<string, ChecklistEntry>();
  const rockIdsCache = { current: '' };

  const matchLabel = document.createElement('label');
  matchLabel.className = 'field-label';
  const matchSelect = document.createElement('select');
  for (const [value, text] of [
    ['top', en.filter.rockMatchTop],
    ['any', en.filter.rockMatchAny],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    matchSelect.append(option);
  }
  matchSelect.addEventListener('change', () => {
    setFilter({ rockMatch: matchSelect.value === 'any' ? 'any' : ('top' as RockMatchMode) });
  });
  matchLabel.append(matchSelect);
  rockBody.append(matchLabel);
  container.append(rockSection);

  // --- Biome ---
  const biomeDisclosure = buildFilterDisclosure(storage, 'biome', en.filter.biomeHeading);
  const biomeSection = biomeDisclosure.details;
  const biomeBody = biomeDisclosure.body;
  let biomeIdsForButtons: readonly string[] = [];
  biomeBody.append(
    buildChecklistHead(
      () => setFilter({ biomes: selectAllIds(biomeIdsForButtons) }),
      () => setFilter({ biomes: selectNoneIds() }),
    ),
  );
  const biomeList = document.createElement('ul');
  biomeList.className = 'filter-checklist';
  biomeBody.append(biomeList);
  const biomeEntries = new Map<string, ChecklistEntry>();
  const biomeIdsCache = { current: '' };
  container.append(biomeSection);

  // --- Temperature / rainfall ---
  const initialFilter = store.getState().filter;
  const tempRow = buildFilterRangeRow(
    en.filter.temperatureHeading,
    initialFilter.tempMin,
    initialFilter.tempMax,
    en.filter.temperatureMinPlaceholder,
    en.filter.temperatureMaxPlaceholder,
    (tempMin) => setFilter({ tempMin }),
    (tempMax) => setFilter({ tempMax }),
  );
  const rainRow = buildFilterRangeRow(
    en.filter.rainfallHeading,
    initialFilter.rainMin,
    initialFilter.rainMax,
    en.filter.rainfallMinPlaceholder,
    en.filter.rainfallMaxPlaceholder,
    (rainMin) => setFilter({ rainMin }),
    (rainMax) => setFilter({ rainMax }),
  );
  const rangesSection = document.createElement('div');
  rangesSection.className = 'filter-ranges';
  rangesSection.append(tempRow.row, rainRow.row);
  container.append(rangesSection);

  // --- Ore/mineral: disc-shaped veins only (this phase) -- `en.oreNames`'s keys are exactly the
  // ids `src/worldgen/tfc-1.20/features/disc-vein.ts`'s `SUPPORTED_DISC_VEINS` can place (see that
  // file's header for the three surface-relative discs still excluded). UI code stays ignorant of
  // *which* profile or vein shape produced an id -- it only ever sees `DepositFeature.ore` strings
  // and this static, profile-agnostic name list, never a worldgen import (AGENTS.md section 3).
  // An empty selection means "show every available ore/mineral", matching `MapState.oreFilter`'s
  // doc comment -- so unchecking every box is not the same as selecting all of them by hand.
  const oreDisclosure = buildFilterDisclosure(storage, 'ore', en.filter.oreHeading);
  const oreField = oreDisclosure.details;
  oreField.classList.add('filter-ore');
  const oreBody = oreDisclosure.body;

  // A search box, because TerraFirmaGreg offers 75 veins and scanning that by eye is not filtering.
  // It matches the *label*, which includes what a vein yields -- so typing "silver" finds galena,
  // which is the whole reason the yields are in the label.
  const oreSearch = document.createElement('input');
  oreSearch.type = 'search';
  oreSearch.className = 'filter-ore__search';
  oreSearch.placeholder = en.filter.oreSearchPlaceholder;
  oreSearch.setAttribute('aria-label', en.filter.oreSearchPlaceholder);
  oreBody.append(oreSearch);

  const oreList = document.createElement('ul');
  oreList.className = 'filter-checklist';
  oreBody.append(oreList);

  // Accuracy floor. A marker's odds are mostly its depth (see `markerConfidence`), so this is the
  // one control that trades coverage for certainty -- the trade a player makes after walking to a
  // marker and finding nothing.
  const accuracyRow = document.createElement('label');
  accuracyRow.className = 'filter-accuracy';
  const accuracyLabel = document.createElement('span');
  accuracyLabel.textContent = en.filter.oreAccuracyLabel;
  const accuracySelect = document.createElement('select');
  accuracySelect.className = 'filter-accuracy__select';
  for (const [value, text] of [
    [0, en.filter.oreAccuracyOff],
    [0.85, '85%'],
    [0.9, '90%'],
    [0.95, '95%'],
    [0.99, '99%'],
  ] as const) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = text;
    accuracySelect.append(option);
  }
  accuracySelect.addEventListener('change', () => {
    store.setState({ minMarkerAccuracy: Number(accuracySelect.value) });
  });
  const accuracyNote = document.createElement('small');
  accuracyNote.className = 'filter-accuracy__note';
  accuracyNote.textContent = en.filter.oreAccuracyNote;
  accuracyRow.append(accuracyLabel, accuracySelect);
  oreBody.append(accuracyRow, accuracyNote);

  const oreEmpty = document.createElement('p');
  oreEmpty.className = 'filter-ore__note';
  oreEmpty.hidden = true;
  oreBody.append(oreEmpty);
  const oreEntries = new Map<string, ChecklistEntry>();
  // Bare ids (no 'tfc:' prefix), same convention as `en.rockNames`/`en.biomeNames` -- matched
  // against `DepositFeature.ore` with its prefix stripped (see `main.ts`'s marker filter).
  let oreIds = Object.keys(en.oreNames).sort();
  const oreIdsCache = { current: '' };
  container.append(oreField);

  // --- Structures: one chip per kind, icon first, the way the map shows them. An empty selection
  // means every kind, the same convention as the ore filter.
  const structureDisclosure = buildFilterDisclosure(storage, 'structures', en.structures.heading);
  const structureBody = structureDisclosure.body;
  const allStructureSets = Object.keys(STRUCTURE_KINDS);
  const setStructureFilter = (ids: readonly string[]): void => {
    const state = store.getState();
    store.setState({
      structureFilter: ids.length === allStructureSets.length ? [] : [...ids],
      ...(ids.length > 0 && !state.enabledLayers.includes('structures')
        ? { enabledLayers: [...state.enabledLayers, 'structures'] }
        : {}),
    });
  };
  structureBody.append(
    buildChecklistHead(
      () => setStructureFilter(allStructureSets),
      // Nothing selected must not read as "everything": a sentinel no set id can equal.
      () => store.setState({ structureFilter: ['none'] }),
    ),
  );
  const structureChips = document.createElement('div');
  structureChips.className = 'structure-chips';
  const chipButtons = new Map<string, HTMLButtonElement>();
  for (const setId of allStructureSets) {
    const kind = structureKindFor(setId);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'structure-chip';
    const icon = document.createElement('span');
    icon.className = 'structure-chip__icon';
    icon.style.setProperty('--structure-colour', `var(--${kind.colour})`);
    icon.append(createGlyphSvg(kind.glyph, 'structure-chip__glyph'));
    const name = document.createElement('span');
    name.className = 'structure-chip__name';
    name.textContent = en.structureKinds[setId] ?? setId;
    chip.title = name.textContent;
    chip.append(icon, name);
    chip.addEventListener('click', () => {
      const current = store.getState().structureFilter ?? [];
      const shown =
        current.length === 0 ? allStructureSets : current.filter((id) => allStructureSets.includes(id));
      setStructureFilter(shown.includes(setId) ? shown.filter((id) => id !== setId) : [...shown, setId]);
    });
    chipButtons.set(setId, chip);
    structureChips.append(chip);
  }
  structureBody.append(structureChips);
  container.append(structureDisclosure.details);

  // --- Clear ---
  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'filter-clear';
  clearButton.textContent = en.filter.clear;
  clearButton.addEventListener('click', () => {
    store.setState({ filter: DEFAULT_MAP_FILTER, oreFilter: [] });
  });
  container.append(clearButton);

  /**
   * Hides the rows that do not match the search, rather than rebuilding the list.
   *
   * Hiding keeps a checked box checked while you narrow the list, so a selection built up over
   * several searches survives -- rebuilding would silently drop it.
   */
  function applyOreSearch(): void {
    const query = oreSearch.value.trim().toLowerCase();
    const shown: string[] = [];
    for (const [id, entry] of oreEntries) {
      const match = query === '' || oreLabel(id).toLowerCase().includes(query);
      entry.li.hidden = !match;
      if (match) shown.push(id);
      // Both lines are written here rather than at build time: the amounts arrive late
      // (`loadBlockCounts`) and the leading material changes with the query.
      const detail = entry.li.querySelector('.filter-checklist__detail');
      if (detail) detail.textContent = oreDetailText(id, query);
      const label = entry.li.querySelector('label');
      if (label) label.title = oreTooltipText(id);
    }

    // Searching "gold" answers "which vein should I go to" by the order itself: most of that
    // material first. A vein whose size is not ported has no amount, so it sorts after the ones
    // that do, by share.
    if (query !== '') {
      shown.sort((a, b) => {
        const hitA = searchHit(a, query);
        const hitB = searchHit(b, query);
        const amount = (id: string, hit: { share: number } | null): number => {
          const blocks = oreBlocks.get(id) ?? null;
          return hit === null || blocks === null ? -1 : blocks * hit.share;
        };
        return (
          amount(b, hitB) - amount(a, hitA) ||
          (hitB?.share ?? 0) - (hitA?.share ?? 0) ||
          formatOreName(a).localeCompare(formatOreName(b))
        );
      });
    }
    for (const id of shown) {
      const entry = oreEntries.get(id);
      if (entry) oreList.append(entry.li);
    }

    oreEmpty.hidden = shown.length > 0;
    oreEmpty.textContent = en.filter.oreSearchEmpty.replace('{query}', oreSearch.value.trim());
  }

  /**
   * Fills in the block counts once the panel is on screen.
   *
   * Each count walks a vein's whole bounding box — about 150 ms for a profile — so paying it during
   * the render would show as a stutter on every profile change. The rows render with depth alone and
   * gain their size a moment later; `applyOreSearch` rewrites both lines when it lands.
   */
  function loadBlockCounts(profile: ProfileId, typical: (id: string) => number | null): void {
    if (blocksLoadedFor === profile) return;
    blocksLoadedFor = profile;
    oreBlocks = new Map();
    const ids = [...oreEntries.keys()];
    const run = (): void => {
      for (const id of ids) oreBlocks.set(id, typical(id));
      applyOreSearch();
    };
    const idle = (window as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
    if (idle) idle(run);
    else setTimeout(run, 0);
  }
  oreSearch.addEventListener('input', applyOreSearch);

  let lastSignature = '';
  /** What each vein yields, refreshed with the profile. */
  let oreYields: Readonly<Record<string, readonly string[]>> = {};
  /** What a real world said about each vein, refreshed with the profile — see `verify-veins.py`. */
  let oreReliability: NonNullable<ProfileDescriptor['depositReliability']> = {};
  /** Where each vein generates, refreshed with the profile. */
  let oreYRanges: NonNullable<ProfileDescriptor['depositYRanges']> = {};
  /** What each vein's blocks are made of, refreshed with the profile. */
  let oreMix: NonNullable<ProfileDescriptor['depositMix']> = {};
  /** Typical blocks per vein, filled in off the critical path -- see `loadBlockCounts`. */
  let oreBlocks = new Map<string, number | null>();
  let blocksLoadedFor: ProfileId | null = null;

  /**
   * A vein's label: its human name, plus what it actually places when that differs.
   *
   * The names alone cannot answer the question people actually have. TerraFirmaGreg has no silver
   * vein at all — silver comes out of galena, lead and bismuth — so a list of vein names hides it
   * completely. Only the materials the name does not already imply are appended, so common veins
   * stay short.
   */
  /** What a vein yields beyond what its name already says, e.g. galena's silver. */
  function oreYieldsText(id: string): string {
    const name = formatOreName(id);
    return (oreYields[id] ?? [])
      .map((material) => formatMaterialName(material))
      .filter((material) => !name.toLowerCase().includes(material.toLowerCase()))
      .join(', ');
  }

  /**
   * "Y -50 to 20", or "-40 to -10 from surface" for a projected vein. The depth is the first thing a
   * player needs from an ore — a surface vein is a walk, a deep one is a mineshaft — so it leads the
   * detail line, ahead of the extra materials.
   */
  function oreDepthText(id: string): string {
    const range = oreYRanges[id];
    if (!range) return '';
    const span = `${range.minY} to ${range.maxY}`;
    return range.project
      ? en.filter.oreDepthFromSurface.replace('{range}', span)
      : en.filter.oreDepthAbsolute.replace('{range}', span);
  }

  /**
   * The second line under an ore's name: depth and size, and — when a search names a material — how
   * much of *that* material a vein holds, first, because that is the question being asked.
   */
  /**
   * "accuracy 84%", when we have measured that vein against a real world. A calibrated promise
   * beats a broken one: a player forgives 84% announced, not 100% claimed and wrong.
   */
  function oreConfidenceText(id: string): string {
    const entry = oreReliability[id];
    if (!entry || entry.checked < RELIABILITY_MIN_SAMPLE) return '';
    if (entry.precision < UNRELIABLE_PRECISION) return en.filter.oreUnverified;
    return en.filter.oreConfirmed.replace('{n}', String(Math.round(entry.precision * 100)));
  }

  function oreDetailText(id: string, query = ''): string {
    const blocks = oreBlocks.get(id) ?? null;
    const total = blocks === null ? '' : en.filter.oreBlocks.replace('{n}', formatCount(blocks));
    const hit = searchHit(id, query);
    const confidence = oreConfidenceText(id);
    if (hit === null) {
      return [oreDepthText(id), total, confidence].filter((part) => part !== '').join(' · ');
    }

    const lead =
      blocks === null
        ? `${formatMaterialName(hit.material)} ${Math.round(hit.share * 100)}%`
        : en.filter.oreSearchHit
            .replace('{material}', formatMaterialName(hit.material))
            .replace('{n}', formatCount(Math.round(blocks * hit.share)));
    // The vein's total is deliberately not repeated here: with it the line ellipsises in a
    // three-column list, and it is one hover away in the breakdown.
    return [lead, oreDepthText(id), confidence].filter((part) => part !== '').join(' · ');
  }

  const formatCount = (value: number): string => value.toLocaleString('en-US');

  /** One material of a vein, with its count when the vein's size is known and its share always. */
  function mixRow(id: string, entry: { material: string; share: number }): string {
    const blocks = oreBlocks.get(id) ?? null;
    const pct = String(Math.round(entry.share * 100));
    const material = formatMaterialName(entry.material);
    return blocks === null
      ? en.filter.oreMixRowShare.replace('{material}', material).replace('{pct}', pct)
      : en.filter.oreMixRow
          .replace('{material}', material)
          .replace('{n}', formatCount(Math.round(blocks * entry.share)))
          .replace('{pct}', pct);
  }

  /**
   * The hover text: what one vein is made of, and the one caveat that matters. Deliberately a native
   * `title` -- the row is one line of a dense list, and a styled popover would cover its neighbours.
   */
  function oreTooltipText(id: string): string {
    const mix = oreMix[id] ?? [];
    if (mix.length === 0) return oreLabel(id);
    return [formatOreName(id), ...mix.map((entry) => mixRow(id, entry)), en.filter.oreMixNote].join(
      '\n',
    );
  }

  /** The material a query names, within one vein's mix: what the row leads with and sorts by. */
  function searchHit(id: string, query: string): { material: string; share: number } | null {
    if (query === '') return null;
    return (
      (oreMix[id] ?? []).find((entry) =>
        formatMaterialName(entry.material).toLowerCase().includes(query),
      ) ?? null
    );
  }

  /** Name plus yields, as one string: what the search matches against. */
  function oreLabel(id: string): string {
    const extras = oreYieldsText(id);
    return extras === '' ? formatOreName(id) : `${formatOreName(id)} · ${extras}`;
  }

  // Only a profile, filter or ore-selection change can alter this panel, but every store change
  // lands here — including each pan frame — and the work below sorts the whole ore list. Checking
  // the three references first makes a pan cost nothing here.
  let renderedProfile: ProfileId | null = null;
  let renderedFilter: MapFilter | null = null;
  let renderedOreFilter: MapState['oreFilter'] | null = null;
  let renderedStructureFilter: MapState['structureFilter'] | null = null;
  function render(): void {
    const state = store.getState();
    if (
      state.profile === renderedProfile &&
      state.filter === renderedFilter &&
      state.oreFilter === renderedOreFilter &&
      state.structureFilter === renderedStructureFilter
    ) {
      return;
    }
    renderedProfile = state.profile;
    renderedFilter = state.filter;
    renderedOreFilter = state.oreFilter;
    renderedStructureFilter = state.structureFilter;
    {
      const profileHasStructures = listProfiles()
        .find((p) => p.id === state.profile)
        ?.layers.includes('structures');
      structureDisclosure.details.hidden = !profileHasStructures;
      const selected = state.structureFilter ?? [];
      for (const [setId, chip] of chipButtons) {
        chip.setAttribute('aria-pressed', String(selected.length === 0 || selected.includes(setId)));
      }
    }
    const descriptor = listProfiles().find((p) => p.id === state.profile);
    oreYields = descriptor?.depositYields ?? {};
    oreYRanges = descriptor?.depositYRanges ?? {};
    oreMix = descriptor?.depositMix ?? {};
    oreReliability = descriptor?.depositReliability ?? {};
    if (descriptor?.id !== blocksLoadedFor) {
      blocksLoadedFor = null;
      oreBlocks = new Map();
    }
    // Per dimension, not per profile: the Beneath's 29 veins and the overworld's 81 are different
    // tables, and a filter offering the wrong one can only ever match nothing.
    const dimensionOres = descriptor?.dimensionDepositOres?.[state.dimension];
    oreIds = dimensionOres
      ? [...new Set(dimensionOres)]
      : descriptor?.depositOres
        ? [...descriptor.depositOres]
        : Object.keys(en.oreNames).sort();
    // Alphabetical by what the user reads, not by internal id -- `deep_*` and `normal_*` otherwise
    // clump every material of the same depth together and scatter each metal across the list.
    oreIds.sort((a, b) => formatOreName(a).localeCompare(formatOreName(b)));
    const rockIds = Object.keys(descriptor?.rockPalette ?? {});
    // The legend follows the dimension, not the profile: the Beneath's 17 biomes and the overworld's
    // 109 are different lists, and showing one while looking at the other is a legend that lies.
    const biomeIds =
      descriptor?.dimensionBiomeIds?.[state.dimension] ?? Object.keys(descriptor?.biomePalette ?? {});
    const signature = `${state.profile}|${state.dimension}|${JSON.stringify(state.filter)}|${rockIds.join(',')}|${biomeIds.join(',')}|${(state.oreFilter ?? []).join(',')}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    rockSection.hidden = rockIds.length === 0;
    rockIdsForButtons = rockIds;
    syncChecklist(
      rockList,
      rockEntries,
      rockIdsCache,
      rockIds,
      state.filter.rocks,
      (id) => en.rockNames[id] ?? id,
      (id, checked) => {
        const current = store.getState().filter.rocks;
        setFilter({
          rocks: checked ? [...current, id] : current.filter((existing) => existing !== id),
        });
      },
      // The same colour the rock layer paints, so the list doubles as its legend.
      (id) => descriptor?.rockPalette?.[id] ?? 0,
    );
    if (matchSelect.value !== state.filter.rockMatch) matchSelect.value = state.filter.rockMatch;

    biomeSection.hidden = biomeIds.length === 0;
    biomeIdsForButtons = biomeIds;
    syncChecklist(
      biomeList,
      biomeEntries,
      biomeIdsCache,
      biomeIds,
      state.filter.biomes,
      formatBiomeName,
      (id, checked) => {
        const current = store.getState().filter.biomes;
        setFilter({
          biomes: checked ? [...current, id] : current.filter((existing) => existing !== id),
        });
      },
      // The same expression `biomeLayer` paints with, so the swatch is the colour on the map even
      // where no palette entry exists.
      (id) => descriptor?.biomePalette?.[id] ?? categoricalColor(hashString(id)),
    );

    syncNumberInput(tempRow.minInput, state.filter.tempMin);
    syncNumberInput(tempRow.maxInput, state.filter.tempMax);
    syncNumberInput(rainRow.minInput, state.filter.rainMin);
    syncNumberInput(rainRow.maxInput, state.filter.rainMax);

    syncChecklist(
      oreList,
      oreEntries,
      oreIdsCache,
      oreIds,
      state.oreFilter ?? [],
      formatOreName,
      (id, checked) => {
        const currentState = store.getState();
        const current = currentState.oreFilter ?? [];
        store.setState({
          oreFilter: checked ? [...current, id] : current.filter((existing) => existing !== id),
          ...(checked && !currentState.enabledLayers.includes('minerals')
            ? { enabledLayers: [...currentState.enabledLayers, 'minerals'] }
            : {}),
        });
      },
      // The swatch uses the same resolved `--ore-*` tokens as the canvas markers.
      (id: string) => oreMarkerColor(id, getThemeTokens().colors),
      oreTooltipText,
      (id) => oreDetailText(id),
    );
    accuracySelect.value = String(state.minMarkerAccuracy ?? 0);
    // The list is rebuilt when the profile changes, so the search has to be re-applied to it.
    applyOreSearch();
    if (descriptor?.typicalBlocks) loadBlockCounts(descriptor.id, descriptor.typicalBlocks);

    clearButton.disabled = !isFilterSet(state.filter) && (state.oreFilter ?? []).length === 0;
  }

  render();
  store.subscribe(render);
}

/** Whether any field differs from the all-default filter -- drives the "Clear filter" button's
 * disabled state. Deliberately not `isFilterActive` from `@layers/filter`: a `rockMatch` of 'any'
 * with no rocks selected is inert on the map (nothing to clear that would change rendering) but is
 * still a real edit a user might want the button to reset. */
function isFilterSet(filter: MapFilter): boolean {
  return (
    filter.rocks.length > 0 ||
    filter.rockMatch !== 'top' ||
    filter.biomes.length > 0 ||
    filter.tempMin !== null ||
    filter.tempMax !== null ||
    filter.rainMin !== null ||
    filter.rainMax !== null
  );
}

/**
 * Wraps one side-panel section in a collapsible disclosure (docs/PLAN.md 10c P2).
 *
 * Built on `<details>`/`<summary>`: the open/closed behaviour, the keyboard handling and the ARIA
 * state all come from the platform, so this only has to remember the choice. The section's own
 * `<h3>` becomes the summary text and is removed, so the title is not printed twice.
 *
 * The open state is persisted per section through `@platform/storage` (never `localStorage`
 * directly -- AGENTS.md section 6), so a panel the user collapsed stays collapsed on reload.
 */
export function mountCollapsibleSection(options: {
  readonly parent: HTMLElement;
  readonly key: string;
  readonly storage: StorageAdapter;
  readonly defaultOpen: boolean;
  readonly fallbackTitle: string;
  readonly build: (body: HTMLElement) => void;
}): void {
  const { parent, key, storage, defaultOpen, fallbackTitle, build } = options;
  const storageKey = `panel-open:${key}`;

  const details = document.createElement('details');
  details.className = 'panel-section';
  details.open = defaultOpen;

  const summary = document.createElement('summary');
  summary.className = 'panel-section__summary';
  const glyph = PANEL_GLYPHS[key as keyof typeof PANEL_GLYPHS];
  if (glyph) {
    summary.append(createGlyphSvg(glyph, 'panel-section__icon'));
  }
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'panel-section__body';
  details.append(body);
  parent.append(details);

  build(body);

  // The section titled itself; promote that title into the summary rather than showing both.
  const heading = body.querySelector('h3');
  summary.append(document.createTextNode(heading?.textContent?.trim() || fallbackTitle));
  heading?.remove();

  void storage.get<boolean>(storageKey).then((stored) => {
    if (typeof stored === 'boolean') details.open = stored;
  });
  details.addEventListener('toggle', () => {
    void storage.set(storageKey, details.open);
  });
}

export interface ScaleBar {
  update(): void;
}

/** Draws a "nice" round-number scale bar (1/2/5 x 10^n blocks) sized for the current zoom. */
export function mountScaleBar(container: HTMLElement, getZoom: () => number): ScaleBar {
  container.classList.add('scale-bar');
  const bar = document.createElement('div');
  bar.className = 'scale-bar__bar';
  const text = document.createElement('span');
  text.className = 'scale-bar__label';
  container.append(bar, text);

  function update(): void {
    const bpp = blocksPerPixel(getZoom());
    const targetPx = 100;
    const rawBlocks = targetPx * bpp;
    const magnitude = 10 ** Math.floor(Math.log10(rawBlocks));
    const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
    let best = candidates[0] ?? 1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const diff = Math.abs(candidate / bpp - targetPx);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
    const px = best / bpp;
    bar.style.width = `${px}px`;
    text.textContent = `${formatBlocks(best)} ${en.scale.unit}`;
  }

  function formatBlocks(n: number): string {
    return n >= 1000 ? `${n / 1000}k` : `${n}`;
  }

  update();
  return { update };
}

export interface HoverReadoutOptions {
  readonly container: HTMLElement;
  /**
   * Best-effort synchronous probe called on every hover — see `WorldGenerator.probeFast`. Must
   * never take long enough to drop a frame; a field it cannot cheaply answer comes back `null` on
   * the returned `Probe` and is shown as unavailable until `requestProbe` fills it in.
   */
  readonly probe: (x: number, z: number) => Probe;
  /** Full probe, routed through the worker pool, used only to fill in what `probe` left `null`. */
  readonly requestProbe: (x: number, z: number) => { id: number; promise: Promise<Probe> };
  readonly cancelProbe: (id: number) => void;
  readonly debounceMs?: number;
  readonly showRegionDebug?: () => boolean;
  /** Live `temperatureScale` world setting, for the seasonal range in the readout. */
  readonly temperatureScale?: () => number;
}

export interface HoverReadout {
  /** Updates the readout for a hovered block. Ignored while pinned. */
  show(block: { x: number; z: number } | null): void;
  /** Shows a clicked deposit's details in the Deposits group. */
  selectDeposit(deposit: DepositFeature | null): void;
  /**
   * Shows a clicked structure in its own group, with a completed toggle. `null` clears it.
   * `completed` is read each time the box repaints, so the toggle reflects the latest state.
   */
  selectStructure(
    structure: StructureFeature | null,
    progress?: { readonly completed: () => boolean; readonly toggle: () => void },
  ): void;
  /** Moves the box with the cursor. Ignored while pinned. */
  follow(screen: { x: number; y: number } | null): void;
  /** Freezes the box at a clicked point until it is dismissed. */
  pin(block: { x: number; z: number }, screen: { x: number; y: number }): void;
  /** Releases a pinned box. */
  unpin(): void;
  isPinned(): boolean;
}

function rockName(id: string | null | undefined): string {
  return id == null ? NO_VALUE : (en.rockNames[id] ?? id);
}

export interface ReadoutRow {
  readonly label: string;
  readonly value: string;
}

/** One panel section — Position / Climate / Geology / Deposits (AGENTS.md's grouping for slice 2). */
export interface ReadoutGroup {
  readonly heading: string;
  readonly rows: readonly ReadoutRow[];
  /** Shown instead of rows when there is nothing to display yet — only ever `Deposits` today
   * (Phase 6). Never invent rows to fill an empty group. */
  readonly emptyNote?: string;
}

/**
 * Pure formatter: turns a `Probe` into the grouped rows the panel renders, with `NO_VALUE` (an em
 * dash) for every field the generator could not answer — never the strings "null"/"undefined".
 * Kept free of the DOM so it is unit-testable (tests/unit/hover-readout.test.ts).
 */
export function buildReadoutGroups(
  probe: Probe,
  showRegionDebug = false,
  deposit: DepositFeature | null = null,
  /**
   * The world's `temperatureScale` setting, which sets how wide the seasonal swing is at a given Z
   * (`OverworldClimateModel.calculateMonthlyTemperature`). Defaults to TFC's own default so a
   * caller that has no settings still gets a sensible band rather than none.
   */
  temperatureScale = DEFAULT_TEMPERATURE_SCALE,
  /** A clicked structure marker, shown in its own group. */
  structure: StructureFeature | null = null,
): readonly ReadoutGroup[] {
  const r = en.readout;
  const terrain = probe.terrain;

  const positionRows: ReadoutRow[] = [
    { label: r.block, value: `${Math.floor(probe.x)}, ${Math.floor(probe.z)}` },
    { label: r.chunk, value: `${probe.chunkX}, ${probe.chunkZ}` },
  ];
  if (showRegionDebug && probe.regionDebug) {
    positionRows.push({
      label: r.regionCenter,
      value: `${Math.round(probe.regionDebug.centerX)}, ${Math.round(probe.regionDebug.centerZ)}`,
    });
  }

  const climateRows: ReadoutRow[] = [
    {
      label: r.temperature,
      value: probe.climate ? `${probe.climate.temperature.toFixed(1)} °C` : NO_VALUE,
    },
    {
      label: r.rainfall,
      value: probe.climate ? `${probe.climate.rainfall.toFixed(0)} mm` : NO_VALUE,
    },
    // The seasonal swing, not just the annual average: TFC checks crops against the temperature at
    // the time, so the winter minimum is what actually decides what a player can plant.
    ...(probe.climate
      ? [
          {
            label: r.seasonalRange,
            value: (() => {
              const season = seasonalTemperatureRange(
                probe.climate.temperature,
                probe.z,
                temperatureScale,
              );
              return `${season.min.toFixed(1)} to ${season.max.toFixed(1)} °C`;
            })(),
          },
        ]
      : []),
  ];

  const geologyRows: ReadoutRow[] = [
    {
      label: r.biome,
      value: probe.biome === null ? NO_VALUE : (en.biomeNames[probe.biome] ?? probe.biome),
    },
    { label: r.landOrOcean, value: terrain ? (terrain.land ? r.land : r.ocean) : NO_VALUE },
    { label: `${r.rock}: ${r.rockTop}`, value: rockName(probe.rocks?.top) },
    { label: `${r.rock}: ${r.rockMiddle}`, value: rockName(probe.rocks?.middle) },
    { label: `${r.rock}: ${r.rockBottom}`, value: rockName(probe.rocks?.bottom) },
    { label: `${r.rock}: ${r.rockSurface}`, value: rockName(probe.rocks?.surface) },
  ];

  // Populated only by a click on a `minerals`-layer marker (`HoverReadout.selectDeposit`), never
  // by hovering -- deposits are sparse, so most positions genuinely have none, and a hover-driven
  // "nearest deposit within N pixels" search would silently invent an association the player did
  // not ask for. `deposit === null` renders the explicit empty note, never fabricated rows.
  const depositRows: ReadoutRow[] = deposit
    ? [
        {
          label: r.depositOre,
          // Human name, never a resource id, and it keeps TFG's depth qualifier because a surface
          // vein and a deep one are a different trip (docs/PLAN.md 10c).
          value: formatOreName(deposit.ore),
        },
        { label: r.block, value: `${deposit.x}, ${deposit.z}` },
        { label: r.depositYRange, value: `${deposit.bottomY} to ${deposit.topY}` },
        { label: r.depositRarity, value: String(deposit.rarity) },
        // Vein size, patch footprint and the typical ore-block count are deliberately not shown:
        // they are generator internals, and the two approximate ones invited a precision the port
        // cannot back. What a player acts on is where it is and how deep.
      ]
    : [];

  return [
    { heading: r.groups.position, rows: positionRows },
    { heading: r.groups.climate, rows: climateRows },
    { heading: r.groups.geology, rows: geologyRows },
    {
      heading: r.groups.deposits,
      rows: depositRows,
      ...(depositRows.length === 0 ? { emptyNote: r.depositsEmpty } : {}),
    },
    // Only when a structure marker was clicked: an always-present empty group would add a heading
    // to every hover for a layer most views do not have on.
    ...(structure
      ? [
          {
            heading: r.groups.structure,
            rows: [
              {
                label: en.structures.kind,
                value: en.structureKinds[structureSetOf(structure.id)] ?? structureSetOf(structure.id),
              },
              { label: en.structures.variant, value: structureVariantName(structure.type) },
              { label: en.structures.block, value: `${structure.x}, ${structure.z}` },
            ],
          },
        ]
      : []),
  ];
}

/** `tfc_ruined_world:small_limestone_church_2` -> "Small limestone church 2". */
export function structureVariantName(id: string): string {
  const path = id.slice(id.indexOf(':') + 1);
  const words = path.slice(path.lastIndexOf('/') + 1).replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function renderReadoutGroups(container: HTMLElement, groups: readonly ReadoutGroup[]): void {
  container.replaceChildren();
  for (const group of groups) {
    const section = document.createElement('section');
    section.className = 'hover-readout__group';

    const heading = document.createElement('h4');
    heading.className = 'hover-readout__heading';
    heading.textContent = group.heading;
    section.append(heading);

    if (group.rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hover-readout__empty';
      empty.textContent = group.emptyNote ?? '';
      section.append(empty);
    } else {
      const list = document.createElement('dl');
      list.className = 'hover-readout__rows';
      for (const row of group.rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'hover-readout__row';
        const label = document.createElement('dt');
        label.className = 'hover-readout__label';
        label.textContent = row.label;
        const value = document.createElement('dd');
        value.className = 'hover-readout__value';
        value.textContent = row.value;
        rowEl.append(label, value);
        list.append(rowEl);
      }
      section.append(list);
    }
    container.append(section);
  }
}

/**
 * Hovering any pixel shows exact block X/Z, chunk, region and generator values (AGENTS.md 1a), as
 * a compact grouped panel (Position / Climate / Geology / Deposits).
 *
 * Fast by construction: `options.probe` is called synchronously on every hover and must answer
 * instantly (see `WorldGenerator.probeFast`) — no debounce gates it. Only when it leaves a field
 * `null` (a region genuinely not built yet) does this fall back, after a short debounce, to
 * `requestProbe`'s worker-routed full probe to fill in the rest.
 */
/**
 * Clipboard write with a fallback: the async Clipboard API is missing or refused in some contexts
 * (a page opened from disk, an unfocused page), where a selected textarea still works.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea path */
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

export function mountHoverReadout(options: HoverReadoutOptions): HoverReadout {
  const { container } = options;
  container.hidden = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRequestId: number | null = null;
  let lastKey: string | null = null;
  let lastProbe: Probe | null = null;
  let selectedDeposit: DepositFeature | null = null;
  let selectedStructure: StructureFeature | null = null;
  let structureProgress: { readonly completed: () => boolean; readonly toggle: () => void } | null = null;
  /**
   * Pinned by a map click: the box stops following the cursor and stays put, including when the
   * pointer leaves the map entirely. Only another click, the close control or Escape releases it
   * (docs/PLAN.md 10c P2).
   */
  let pinned = false;

  /** Offset from the cursor, so the box never sits under the pointer it is describing. */
  const FOLLOW_OFFSET_PX = 14;

  function follow(screen: { x: number; y: number } | null): void {
    if (pinned || !screen) return;
    place(screen);
  }

  /**
   * Positions the box near a point, flipping sides near an edge so it stays on the map.
   *
   * Bounded by the map canvas, not the box's offset parent: that parent also holds the side panel,
   * so the box used to spill over the panel near the map's right edge — and, with the panel stacked
   * under the map on a narrow window, drop below the map entirely. The canvas sits at the parent's
   * origin in both layouts, so its size is the usable area.
   */
  // The last point the box was placed at. `paint` re-places from it: placement measures the box,
  // and a box measured before its rows were rendered is narrower than the one that gets drawn,
  // which let the rendered box run off the right edge of a narrow map.
  let lastPlaced: { x: number; y: number } | null = null;

  function place(screen: { x: number; y: number }): void {
    lastPlaced = screen;
    const parent = container.offsetParent as HTMLElement | null;
    const map = parent?.querySelector('canvas');
    const maxX = map?.clientWidth ?? parent?.clientWidth ?? window.innerWidth;
    const maxY = map?.clientHeight ?? parent?.clientHeight ?? window.innerHeight;
    const w = container.offsetWidth || 240;
    const h = container.offsetHeight || 160;
    const left =
      screen.x + FOLLOW_OFFSET_PX + w > maxX
        ? screen.x - FOLLOW_OFFSET_PX - w
        : screen.x + FOLLOW_OFFSET_PX;
    const top =
      screen.y + FOLLOW_OFFSET_PX + h > maxY
        ? screen.y - FOLLOW_OFFSET_PX - h
        : screen.y + FOLLOW_OFFSET_PX;
    // Clamped into the map on both sides; a box wider or taller than the map pins to its corner.
    container.style.left = `${Math.max(0, Math.min(left, maxX - w))}px`;
    container.style.top = `${Math.max(0, Math.min(top, maxY - h))}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
  }

  function clearPending(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastRequestId !== null) {
      options.cancelProbe(lastRequestId);
      lastRequestId = null;
    }
  }

  function paint(probe: Probe): void {
    lastProbe = probe;
    container.hidden = false;
    renderReadoutGroups(
      container,
      buildReadoutGroups(
        probe,
        options.showRegionDebug?.() ?? false,
        selectedDeposit,
        options.temperatureScale?.(),
        selectedStructure,
      ),
    );
    if (selectedStructure) {
      const groups = container.querySelectorAll('.hover-readout__group');
      const group = groups[groups.length - 1];
      if (group) {
        const note = document.createElement('p');
        note.className = 'hover-readout__empty';
        note.textContent = en.structures.approximate;
        group.append(note);
        if (structureProgress) group.append(completedButton(structureProgress));
      }
    }
    if (pinned) {
      container.prepend(closeButton());
      container.append(copyActions(probe));
    }
    if (lastPlaced) place(lastPlaced);
  }

  /** "Mark as completed" / "Completed": the pressed state carries the answer, as the layer toggles do. */
  function completedButton(progress: { readonly completed: () => boolean; readonly toggle: () => void }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'coord-readout__completed';
    const done = progress.completed();
    button.setAttribute('aria-pressed', String(done));
    button.textContent = done ? `\u2713 ${en.structures.completed}` : en.structures.markCompleted;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      progress.toggle();
      if (lastProbe) paint(lastProbe);
    });
    return button;
  }

  /**
   * "Copy /tp" and "Copy X Z" for the pinned point, or for the selected structure when there is one.
   * The /tp height is the estimated surface plus 2 at the pinned block itself; a structure's own
   * column was never probed, so its /tp keeps the player's height (`~`) rather than guess one.
   */
  function copyActions(probe: Probe): HTMLElement {
    const target = selectedStructure
      ? { x: selectedStructure.x, z: selectedStructure.z, y: null as number | null }
      : { x: Math.floor(probe.x), z: Math.floor(probe.z), y: probe.surfaceY === null ? null : Math.round(probe.surfaceY) + 2 };
    const row = document.createElement('div');
    row.className = 'coord-readout__actions';
    const make = (label: string, text: string, title?: string): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'coord-readout__copy';
      button.textContent = label;
      if (title) button.title = title;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        void copyText(text).then((ok) => {
          button.textContent = ok ? en.readout.copied : en.readout.copyFailed;
          setTimeout(() => {
            button.textContent = label;
          }, 1200);
        });
      });
      return button;
    };
    row.append(
      make(en.readout.copyTp, `/tp @s ${target.x} ${target.y ?? '~'} ${target.z}`, en.readout.copyTpTitle),
      make(en.readout.copyCoords, `${target.x} ${target.z}`),
    );
    return row;
  }

  /** Only a pinned box gets a close control -- an unpinned one is dismissed by moving the mouse. */
  function closeButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'coord-readout__close';
    button.title = en.readout.unpin;
    button.setAttribute('aria-label', en.readout.unpin);
    button.textContent = '×';
    button.addEventListener('click', unpin);
    return button;
  }

  function unpin(): void {
    pinned = false;
    selectedDeposit = null;
    selectedStructure = null;
    structureProgress = null;
    container.dataset.pinned = 'false';
    lastKey = null;
    lastProbe = null;
    container.replaceChildren();
    container.hidden = true;
  }

  function pin(block: { x: number; z: number }, screen: { x: number; y: number }): void {
    pinned = false; // so show() below is not suppressed by the previous pin
    show(block);
    pinned = true;
    container.dataset.pinned = 'true';
    place(screen);
  }

  function selectDeposit(deposit: DepositFeature | null): void {
    selectedDeposit = deposit;
    if (lastProbe) paint(lastProbe);
  }

  function selectStructure(
    structure: StructureFeature | null,
    progress?: { readonly completed: () => boolean; readonly toggle: () => void },
  ): void {
    selectedStructure = structure;
    structureProgress = structure ? (progress ?? null) : null;
    if (lastProbe) paint(lastProbe);
  }

  function needsFollowUp(probe: Probe): boolean {
    return (
      probe.climate === null ||
      probe.rocks === null ||
      probe.biome === null ||
      probe.terrain === null
    );
  }

  function show(block: { x: number; z: number } | null): void {
    if (pinned) return;
    clearPending();
    if (!block) {
      lastKey = null;
      lastProbe = null;
      selectedDeposit = null;
      container.replaceChildren();
      container.hidden = true;
      return;
    }
    const key = `${block.x},${block.z}`;
    lastKey = key;

    const fast = options.probe(block.x, block.z);
    paint(fast);

    if (needsFollowUp(fast)) {
      timer = setTimeout(() => {
        const { id, promise } = options.requestProbe(block.x, block.z);
        lastRequestId = id;
        promise
          .then((full) => {
            lastRequestId = null;
            // The cursor may have moved on to a different block while this was in flight.
            if (lastKey === key) paint(full);
          })
          .catch(() => {
            lastRequestId = null;
          });
      }, options.debounceMs ?? 80);
    }
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pinned) unpin();
  });

  return { show, selectDeposit, selectStructure, follow, pin, unpin, isPinned: () => pinned };
}
