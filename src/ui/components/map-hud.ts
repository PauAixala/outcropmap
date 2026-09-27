// Controls that sit on top of the map itself rather than in the side panel: the terrain switch and
// the loading compass. Plain DOM (ADR 0003), theme tokens only (ADR 0005), text via @ui/i18n.
import { en } from '@ui/i18n/en';
import type { MapState, Store } from '@app/state';
import type { LayerId } from '@worldgen/api/types';

/** The layer the terrain switch flips. Shaded relief is what "terrain" means on a 2D map. */
const TERRAIN_LAYER: LayerId = 'hillshade';

/**
 * A switch for shaded relief, on the map where the thing it changes is.
 *
 * It is the same state the layer panel's checkbox holds — deliberately, so neither can disagree
 * with the other — just promoted to somewhere you can reach without opening a panel.
 */
export function mountTerrainToggle(container: HTMLElement, store: Store<MapState>): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'map-hud__button';
  button.title = en.hud.terrainTitle;
  container.append(button);

  function sync(state: MapState): void {
    const on = state.enabledLayers.includes(TERRAIN_LAYER);
    button.textContent = on ? en.hud.terrainOn : en.hud.terrainOff;
    // `aria-pressed` carries the state for assistive tech; the bevel carries it for everyone else.
    button.setAttribute('aria-pressed', String(on));
  }

  button.addEventListener('click', () => {
    const current = store.getState().enabledLayers;
    const next = current.includes(TERRAIN_LAYER)
      ? current.filter((id) => id !== TERRAIN_LAYER)
      : [...current, TERRAIN_LAYER];
    store.setState({ enabledLayers: next });
  });

  sync(store.getState());
  store.subscribe(sync);
}

export interface LoadingCompassOptions {
  readonly container: HTMLElement;
  /** Layer ids whose tiles are still being generated. */
  readonly pendingLayers: () => readonly LayerId[];
  /** Whether ore/mineral/structure features are still being generated. */
  readonly pendingFeatures: () => boolean;
}

export interface LoadingCompass {
  /** Re-reads the pending work and shows or hides accordingly. */
  refresh(): void;
  stop(): void;
}

/**
 * A compass, drawn the way the game draws one: a small octagonal frame around a pale dial with a
 * red-and-white needle. Original geometry on a 16-unit grid — no game texture is used or copied
 * (AGENTS.md section 8). Only the needle turns, which is what a compass does.
 */
function compassSvg(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'map-hud__compass-dial');
  svg.setAttribute('aria-hidden', 'true');

  const frame = document.createElementNS(ns, 'path');
  frame.setAttribute('d', 'M5 1h6l4 4v6l-4 4H5l-4-4V5z');
  frame.setAttribute('class', 'map-hud__compass-frame');
  svg.append(frame);

  const face = document.createElementNS(ns, 'path');
  face.setAttribute('d', 'M6 3h4l3 3v4l-3 3H6l-3-3V6z');
  face.setAttribute('class', 'map-hud__compass-face');
  svg.append(face);

  // The needle is its own group so the CSS spin turns only this, around the dial's centre.
  const needle = document.createElementNS(ns, 'g');
  needle.setAttribute('class', 'map-hud__compass-needle');

  const north = document.createElementNS(ns, 'path');
  north.setAttribute('d', 'M8 4 10 8 8 9 6 8z');
  north.setAttribute('class', 'map-hud__compass-north');
  needle.append(north);

  const south = document.createElementNS(ns, 'path');
  south.setAttribute('d', 'M8 12 6 8 8 7 10 8z');
  south.setAttribute('class', 'map-hud__compass-south');
  needle.append(south);

  svg.append(needle);
  return svg;
}

/**
 * A compass that spins while the map is generating, with the name of what it is waiting for beside
 * it: a spinner that says "Biome" answers the only question a wait raises. Both the compass and the
 * label go away the moment nothing is pending.
 *
 * It polls rather than being pushed to. The managers report completion, not the moment work starts,
 * and a request begins inside the paint loop — a quarter-second poll catches both ends without
 * threading a callback through the renderer.
 */
export function mountLoadingCompass(options: LoadingCompassOptions): LoadingCompass {
  const { container, pendingLayers, pendingFeatures } = options;

  const root = document.createElement('div');
  root.className = 'map-hud__compass';
  root.hidden = true;
  // Announced politely: it is progress, not an alert, and it changes while you pan.
  root.setAttribute('aria-live', 'polite');

  const label = document.createElement('span');
  label.className = 'map-hud__compass-label';
  root.append(compassSvg(), label);
  container.append(root);

  function describe(): string | null {
    const names: string[] = [];
    for (const id of pendingLayers()) {
      const name = en.layerNames[id];
      if (name !== undefined) names.push(name);
    }
    if (pendingFeatures()) names.push(en.hud.features);
    if (names.length === 0) return null;
    names.sort();
    const [first] = names;
    if (first === undefined) return null;
    // One name, plus a count: a full list would grow the badge across the map while you pan.
    return names.length === 1
      ? first
      : `${first} ${en.hud.andMore.replace('{count}', String(names.length - 1))}`;
  }

  function refresh(): void {
    const text = describe();
    if (text === null) {
      root.hidden = true;
      label.textContent = '';
      return;
    }
    if (label.textContent !== text) label.textContent = text;
    root.hidden = false;
  }

  const timer = setInterval(refresh, 250);
  refresh();

  return {
    refresh,
    stop: () => clearInterval(timer),
  };
}
