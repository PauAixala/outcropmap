/**
 * Waypoint side panel (docs/PLAN.md 10c P2).
 *
 * Placement is **armed by picking an icon** — there is no separate "place" button and no coordinate
 * inputs. Nothing is selected when the panel opens; picking an icon arms placement and auto-selects
 * a colour (the last one used, or the first on a fresh session), and picking the armed icon again
 * disarms it. The next click on the map places the waypoint and disarms; while disarmed, a map click
 * pins the readout instead.
 *
 * A waypoint is created **without a label**. Naming happens afterwards: select the row (or click the
 * marker on the map) and type. No label means no text drawn on the map — never a placeholder name.
 */
import type { MapState, Store } from '@app/state';
import {
  WAYPOINT_COLOURS,
  WAYPOINT_ICONS,
  createWaypointId,
  parseWaypointsJson,
  serializeWaypoints,
  type Waypoint,
  type WaypointColour,
  type WaypointController,
  type WaypointIcon,
} from '@app/waypoints';
import { GLYPHS, GLYPH_GRID, glyphToPathData } from '@ui/icons/glyphs';
import { en } from '@ui/i18n';

export interface WaypointPanel {
  /** True while an icon is armed, i.e. the next map click places a waypoint. */
  isPlacing(): boolean;
  /** Places the armed waypoint and disarms. No-op when nothing is armed. */
  placeAt(x: number, z: number): void;
  /** Selects a waypoint for renaming — called when its marker is clicked on the map. */
  select(id: string): void;
}

export interface WaypointPanelOptions {
  readonly container: HTMLElement;
  readonly store: Store<MapState>;
  readonly controller: WaypointController;
  readonly centerOn: (waypoint: Waypoint) => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Builds the icon exactly as the map draws it: the same geometry from `@ui/icons/glyphs`, filled
 * rather than stroked, on the 16x16 integer grid with crisp edges (docs/DESIGN.md section 6).
 * The picker button around it is styled as a miniature of the marker, so choosing an icon shows
 * what will land on the map rather than an unrelated outline.
 */
function iconSvg(icon: WaypointIcon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${GLYPH_GRID} ${GLYPH_GRID}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', glyphToPathData(GLYPHS[icon]));
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.append(path);
  return svg;
}

function formatCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function mountWaypointPanel(options: WaypointPanelOptions): WaypointPanel {
  const { container, store, controller } = options;
  const copy = en.waypoints;

  /** Armed icon, or null when a map click should pin the readout instead of placing. */
  let armedIcon: WaypointIcon | null = null;
  /** Remembered across placements so the user picks a colour once, not once per waypoint. */
  let colour: WaypointColour = WAYPOINT_COLOURS[0];
  /** The row whose name is being edited. */
  let selectedId: string | null = null;

  const heading = document.createElement('h3');
  heading.textContent = copy.heading;

  const picker = document.createElement('div');
  picker.className = 'waypoint-picker-group';

  const iconGroup = document.createElement('fieldset');
  iconGroup.className = 'waypoint-picker';
  const iconLegend = document.createElement('legend');
  iconLegend.textContent = copy.icon;
  iconGroup.append(iconLegend);
  for (const icon of WAYPOINT_ICONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'waypoint-icon-btn';
    button.dataset.icon = icon;
    button.title = copy.iconNames[icon];
    button.setAttribute('aria-label', copy.iconNames[icon]);
    button.append(iconSvg(icon));
    button.addEventListener('click', () => {
      // Picking the armed icon again disarms; picking another switches to it.
      armedIcon = armedIcon === icon ? null : icon;
      render();
    });
    iconGroup.append(button);
  }

  const colourGroup = document.createElement('fieldset');
  colourGroup.className = 'waypoint-picker';
  const colourLegend = document.createElement('legend');
  colourLegend.textContent = copy.colour;
  colourGroup.append(colourLegend);
  for (const value of WAYPOINT_COLOURS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'waypoint-colour-btn';
    button.dataset.colour = value;
    button.style.setProperty('--waypoint-colour', `var(--${value})`);
    button.title = copy.colourNames[value];
    button.setAttribute('aria-label', copy.colourNames[value]);
    button.addEventListener('click', () => {
      colour = value;
      // Changing the colour of a selected waypoint recolours it, rather than only affecting the
      // next one placed — the picker is the only colour control there is.
      if (selectedId) controller.update(selectedId, { colour });
      render();
    });
    colourGroup.append(button);
  }
  picker.append(iconGroup, colourGroup);

  const status = document.createElement('p');
  status.className = 'waypoint-status';
  status.setAttribute('aria-live', 'polite');

  const list = document.createElement('ul');
  list.className = 'waypoint-list';
  // --- Export / import (docs/PLAN.md 10b) ---
  const transfer = document.createElement('div');
  transfer.className = 'waypoint-transfer';

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'filter-select-btn';
  exportButton.textContent = copy.exportLabel;
  exportButton.addEventListener('click', () => {
    const state = store.getState();
    const json = serializeWaypoints(state.waypoints ?? [], {
      seed: state.seed,
      profile: state.profile,
    });
    // A blob URL and a synthetic click: no server and no network.
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `waypoints-${state.seed.toString()}-${state.profile}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.className = 'filter-select-btn';
  importButton.textContent = copy.importLabel;
  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  filePicker.accept = 'application/json,.json';
  filePicker.hidden = true;
  importButton.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => {
        const imported = parseWaypointsJson(text);
        if (imported === null) {
          status.textContent = copy.importFailed;
          return;
        }
        // Merge rather than replace: an imported set is usually somebody else's finds, not a
        // replacement for your own. Ids are regenerated so two files never collide.
        const existing = store.getState().waypoints ?? [];
        controller.setList([
          ...existing,
          ...imported.map((waypoint) => ({ ...waypoint, id: createWaypointId() })),
        ]);
        status.textContent = copy.imported.replace('{count}', String(imported.length));
      })
      .catch(() => {
        status.textContent = copy.importFailed;
      })
      .finally(() => {
        // Clear it, so importing the same file twice in a row still fires a change event.
        filePicker.value = '';
      });
  });

  transfer.append(exportButton, importButton, filePicker);

  container.append(heading, picker, status, list, transfer);

  function renderSelections(): void {
    for (const button of iconGroup.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.icon === armedIcon));
      // Preview in the colour that is actually selected: the pressed button is a miniature of the
      // marker the map will draw (docs/PLAN.md 10c P1).
      button.style.setProperty('--waypoint-colour', `var(--${colour})`);
    }
    for (const button of colourGroup.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.colour === colour));
    }
  }

  /** One list row: pin, name (click to rename), coordinates, delete. Deliberately a single line. */
  function renderRow(waypoint: Waypoint): HTMLLIElement {
    const item = document.createElement('li');
    item.className = 'waypoint-row';
    if (waypoint.id === selectedId) item.dataset.selected = 'true';

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'waypoint-row__pin';
    pin.style.setProperty('--waypoint-colour', `var(--${waypoint.colour})`);
    pin.title = copy.centre;
    pin.setAttribute('aria-label', copy.centre);
    pin.append(iconSvg(waypoint.icon));
    pin.addEventListener('click', () => options.centerOn(waypoint));

    const coords = document.createElement('span');
    coords.className = 'waypoint-row__xz';
    coords.textContent = `${formatCoordinate(waypoint.x)}, ${formatCoordinate(waypoint.z)}`;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'waypoint-row__delete';
    remove.title = copy.delete;
    remove.setAttribute('aria-label', copy.delete);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      controller.remove(waypoint.id);
      if (selectedId === waypoint.id) selectedId = null;
    });

    if (waypoint.id === selectedId) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'waypoint-row__input';
      input.maxLength = 80;
      input.value = waypoint.label;
      input.placeholder = copy.namePlaceholder;
      input.setAttribute('aria-label', copy.name);
      const commit = (): void => {
        const next = input.value.trim();
        if (next !== waypoint.label) controller.update(waypoint.id, { label: next });
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          commit();
          selectedId = null;
          render();
        } else if (event.key === 'Escape') {
          selectedId = null;
          render();
        }
      });
      input.addEventListener('blur', commit);
      item.append(pin, input, coords, remove);
      // Focus after the row is in the document, so the caret lands without scrolling the panel.
      queueMicrotask(() => {
        input.focus();
        input.select();
      });
      return item;
    }

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'waypoint-row__name';
    if (waypoint.label === '') name.dataset.unnamed = 'true';
    name.textContent = waypoint.label === '' ? copy.unnamed : waypoint.label;
    name.title = copy.rename;
    name.addEventListener('click', () => {
      selectedId = waypoint.id;
      colour = waypoint.colour;
      render();
    });

    item.append(pin, name, coords, remove);
    return item;
  }

  // Every store change lands here, and panning changes the store on every frame. Rebuilding the
  // list (and re-sorting it by distance) that often was pure churn, so this only re-renders when
  // the list or a selection changes, or once the view has moved about 64 screen pixels — enough to
  // keep the nearest-first order current without redoing it per frame.
  let renderedWaypoints: MapState['waypoints'] | null = null;
  let renderedKey = '';
  function render(): void {
    const state = store.getState();
    const step = 64 * 2 ** state.zoom;
    const key = `${selectedId}|${armedIcon}|${colour}|${Math.round(state.centerX / step)}|${Math.round(state.centerZ / step)}`;
    if (state.waypoints === renderedWaypoints && key === renderedKey) return;
    renderedWaypoints = state.waypoints;
    renderedKey = key;

    status.textContent = armedIcon ? copy.clickMap : '';
    renderSelections();

    const waypoints = [...(state.waypoints ?? [])].sort(
      (a, b) =>
        Math.hypot(a.x - state.centerX, a.z - state.centerZ) -
        Math.hypot(b.x - state.centerX, b.z - state.centerZ),
    );
    list.replaceChildren();
    if (waypoints.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'waypoint-list__empty';
      empty.textContent = copy.empty;
      list.append(empty);
      return;
    }
    for (const waypoint of waypoints) list.append(renderRow(waypoint));
  }

  render();
  store.subscribe(render);

  return {
    isPlacing: () => armedIcon !== null,
    placeAt(x, z): void {
      if (armedIcon === null) return;
      controller.add({ x: Math.round(x), z: Math.round(z), label: '', icon: armedIcon, colour });
      armedIcon = null;
      // Select what was just placed so the user can name it straight away — `add` generates the id
      // internally, and appends, so the new marker is the last entry.
      const list_ = store.getState().waypoints ?? [];
      selectedId = list_[list_.length - 1]?.id ?? null;
      render();
    },
    select(id): void {
      selectedId = id;
      const found = (store.getState().waypoints ?? []).find((w) => w.id === id);
      if (found) colour = found.colour;
      render();
    },
  };
}
