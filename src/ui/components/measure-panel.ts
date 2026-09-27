/**
 * The measure tool's side-panel section (docs/PLAN.md 10d P1).
 *
 * Arming works the same way waypoint placement does: a single button, and while it is armed the map
 * click sets an end instead of pinning the readout. The panel owns the measurement state; the map
 * page reads it back to paint the line.
 */
import {
  formatBlocks,
  formatDuration,
  measureBetween,
  type MeasurePoint,
  type Measurement,
} from '@app/measure';
import { en } from '@ui/i18n';

export interface MeasurePanel {
  /** True while the next map click sets a measure end. */
  isMeasuring(): boolean;
  /** Sets the next end (start, then finish). Called by the map click handler. */
  addPoint(point: MeasurePoint): void;
  /** Moves the open end with the cursor, giving a live distance before the second click. */
  trackCursor(point: MeasurePoint | null): void;
  /** The two ends to draw, with `b` possibly the cursor. */
  ends(): { readonly a: MeasurePoint | null; readonly b: MeasurePoint | null };
  clear(): void;
}

export interface MeasurePanelOptions {
  readonly container: HTMLElement;
  /** Called whenever the drawn state changed, so the map can repaint. */
  readonly onChange: () => void;
}

export function mountMeasurePanel(options: MeasurePanelOptions): MeasurePanel {
  const { container, onChange } = options;
  const copy = en.measure;

  let armed = false;
  let a: MeasurePoint | null = null;
  let b: MeasurePoint | null = null;
  /** True once the second click landed, so the cursor stops moving the open end. */
  let closed = false;

  const heading = document.createElement('h3');
  heading.textContent = copy.heading;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'measure-btn';
  button.addEventListener('click', () => {
    armed = !armed;
    if (!armed) reset();
    else {
      a = null;
      b = null;
      closed = false;
    }
    render();
    onChange();
  });

  const hint = document.createElement('p');
  hint.className = 'measure-hint';

  const rows = document.createElement('dl');
  rows.className = 'measure-rows';

  container.append(heading, button, hint, rows);

  function reset(): void {
    a = null;
    b = null;
    closed = false;
  }

  function cancel(): void {
    if (!armed && a === null && b === null) return;
    armed = false;
    reset();
    render();
    onChange();
  }

  function row(label: string, value: string, estimate = false): void {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value;
    if (estimate) description.dataset.estimate = 'true';
    rows.append(term, description);
  }

  function renderMeasurement(m: Measurement): void {
    rows.replaceChildren();
    row(copy.distance, `${formatBlocks(m.blocks)} ${copy.blocks}`);
    row(copy.perAxis, `${formatBlocks(m.dx)} / ${formatBlocks(m.dz)}`);
    row(copy.chunks, formatBlocks(m.chunks));
    // Marked as estimates in the markup as well as the copy: these ignore terrain entirely.
    row(copy.walk, formatDuration(m.walkSeconds), true);
    row(copy.sprint, formatDuration(m.sprintSeconds), true);
  }

  const estimateNote = document.createElement('p');
  estimateNote.className = 'measure-hint measure-hint--estimate';
  estimateNote.textContent = copy.estimateNote;
  estimateNote.hidden = true;
  container.append(estimateNote);

  function render(): void {
    button.textContent = armed ? copy.stop : copy.start;
    button.setAttribute('aria-pressed', String(armed));
    button.classList.toggle('measure-btn--active', armed);

    if (!armed) {
      hint.textContent = copy.idle;
      rows.replaceChildren();
      estimateNote.hidden = true;
      return;
    }
    hint.textContent = a === null ? copy.clickStart : closed ? copy.done : copy.clickEnd;

    if (a === null || b === null) {
      rows.replaceChildren();
      estimateNote.hidden = true;
      return;
    }
    renderMeasurement(measureBetween(a, b));
    // Shown only alongside actual times, so the caveat sits next to the thing it qualifies.
    estimateNote.hidden = false;
  }

  render();

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && armed) cancel();
  });

  return {
    isMeasuring: () => armed,
    addPoint(point): void {
      if (!armed) return;
      if (a === null || closed) {
        // A third click starts a fresh measurement rather than silently extending the old one.
        a = point;
        b = point;
        closed = false;
      } else {
        b = point;
        closed = true;
      }
      render();
      onChange();
    },
    trackCursor(point): void {
      if (!armed || a === null || closed) return;
      b = point;
      render();
      onChange();
    },
    ends: () => ({ a, b }),
    clear(): void {
      cancel();
    },
  };
}
