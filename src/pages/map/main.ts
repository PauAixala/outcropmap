/** Entry point for the map viewer page (index.html). */
import '@worldgen/profiles';
import { initTheme, onThemeChange, getThemeTokens } from '@ui/theme/theme';
import {
  mountHeader,
  mountSeedInput,
  mountProfileSelect,
  mountDimensionSelect,
  mountLayerPanel,
  mountFilterPanel,
  mountScaleBar,
  mountTerrainToggle,
  mountLoadingCompass,
  mountHoverReadout,
  mountWorldSettings,
  mountWaypointPanel,
  mountCollapsibleSection,
  mountMeasurePanel,
} from '@ui/components';
import type { MeasurePanel, WaypointPanel } from '@ui/components';
import type { MeasurePoint } from '@app/measure';
import { en } from '@ui/i18n';
import { mountAdSlot } from '@ui/components/ad-slot';
import {
  DEFAULT_MAP_STATE,
  bindStateToLocation,
  createMapStore,
  mapSessionKey,
  decodeMapStateFromHash,
} from '@app/state';
import type { MapState } from '@app/state';
import { WorkerPool } from '@workers/pool';
import { TileManager } from '@render/tiles/tile-manager';
import { FeatureManager } from '@render/tiles/feature-manager';
import { MapCanvas } from '@render/canvas2d/map-canvas';
import { paintFrame } from '@render/canvas2d/painter';
import { MIN_ZOOM, blockToScreen, blocksPerPixel } from '@core/coords/coords';
import { createGenerator, listProfiles } from '@worldgen/registry';
import type { DepositFeature, ProfileDescriptor, WorldGenerator } from '@worldgen/api/types';
import { createStorage } from '@platform/storage';
import { loadCompletedStructures, saveCompletedStructures } from '@app/structure-progress';
import { structureSetOf } from '@ui/icons/structure-glyphs';
import { clusterStructures, type StructureCluster } from '@render/structure-clusters';
import { STRUCTURE_MARKER_PX } from '@render/canvas2d/painter';
import type { StructureFeature } from '@worldgen/api/types';
import { matchesOreFilter } from '@render/markers';
import { markerConfidence, veinFilterId, veinIsUnreliable } from '@worldgen/api/types';

/**
 * Whether a marker clears the accuracy floor the player asked for.
 *
 * A marker with no measurement behind it is kept: the floor hides what we know is doubtful, not
 * what we have not checked. Silently dropping unmeasured profiles would empty the map for TFC.
 */
function meetsAccuracy(
  descriptor: ProfileDescriptor | undefined,
  deposit: DepositFeature,
  floor: number,
): boolean {
  if (floor <= 0) return true;
  const confidence = markerConfidence(
    descriptor?.depositReliability,
    descriptor?.depositDepthReliability,
    veinFilterId(deposit.ore),
    deposit.depthBelowSurface,
  );
  return confidence === null || confidence >= floor;
}
import { isFilterActive } from '@layers/filter';
import { createWaypointController, loadWaypoints } from '@app/waypoints';
import type { Waypoint } from '@app/waypoints';
import {
  loadProfilePreference,
  loadSeedPreference,
  saveProfilePreference,
  saveSeedPreference,
} from '@app/profile-preference';

// The document title comes from i18n like every other string a person reads.
document.title = en.pageTitles.map;

/** Half the drawn marker plus a little slack, so grabbing one does not demand pixel precision. */
const WAYPOINT_HIT_RADIUS_PX = 16;

async function boot(): Promise<void> {
  await initTheme();

  const headerEl = document.getElementById('app-header');
  if (headerEl) mountHeader(headerEl, { page: 'map' });

  const storage = createStorage();
  const hashState = decodeMapStateFromHash(window.location.hash);
  // A link's hash wins; otherwise reopen on the world last looked at.
  const savedProfile =
    hashState.profile === undefined ? await loadProfilePreference(storage) : undefined;
  const savedSeed = hashState.seed === undefined ? await loadSeedPreference(storage) : undefined;
  const initialState: MapState = {
    ...DEFAULT_MAP_STATE,
    ...(savedProfile === undefined ? {} : { profile: savedProfile }),
    ...(savedSeed === undefined ? {} : { seed: savedSeed }),
    ...hashState,
  };
  const store = createMapStore(initialState);
  void saveProfilePreference(storage, store.getState().profile).catch(() => {});
  void saveSeedPreference(storage, store.getState().seed).catch(() => {});
  const waypointController = createWaypointController(store, storage);
  waypointController.setList(
    await loadWaypoints(storage, initialState.seed, initialState.profile),
    false,
  );
  bindStateToLocation(store);

  const canvasEl = document.getElementById('map-canvas');
  const readoutEl = document.getElementById('coord-readout');
  const sidePanel = document.getElementById('side-panel');
  if (!(canvasEl instanceof HTMLCanvasElement) || !readoutEl) {
    return;
  }

  const pool = new WorkerPool();
  let mapCanvas: MapCanvas;
  let waypointPanel: WaypointPanel | null = null;
  let measurePanel: MeasurePanel | null = null;
  const tiles = new TileManager({
    pool,
    onTileReady: () => mapCanvas.requestFrame(),
  });
  const features = new FeatureManager({
    pool,
    onFeaturesReady: () => mapCanvas.requestFrame(),
  });

  // On-map controls: the terrain switch, and a compass that spins while tiles or deposits are
  // still being generated and says which of them it is waiting for.
  const hudEl = document.getElementById('map-hud');
  if (hudEl) {
    mountTerrainToggle(hudEl, store);
    mountLoadingCompass({
      container: hudEl,
      pendingLayers: () => tiles.pendingLayers(),
      pendingFeatures: () => features.isPending(),
    });
  }

  const initial = store.getState();
  // Structures marked as completed in the world on screen; reloaded whenever the world changes.
  let completedStructures = new Set<string>(
    await loadCompletedStructures(storage, initial.seed, initial.profile).catch(() => []),
  );
  let sessionKey = mapSessionKey(initial);
  tiles.setSession(initial.seed, initial.profile, initial.dimension, initial.settings);
  features.setSession(initial.seed, initial.profile, initial.dimension);
  // Tracks the last filter this session's tiles were rendered with, so a criterion change
  // invalidates only the `filter` layer's cached tiles (docs/ARCHITECTURE.md "Caching") instead of
  // a full `tiles.clearAll()` -- a session change already clears everything below, so this never
  // needs to run in that branch.
  let filterKey = JSON.stringify(initial.filter);
  let filterRef = initial.filter;

  // Held on the main thread purely for the hover readout's fast path: `probeFast` (falling back to
  // plain `probe` for profiles without one) answers from whatever the generator's own region cache
  // already holds, so a repeat hover near the cursor costs microseconds instead of a worker round
  // trip. Recreated alongside the worker pool's session on seed/profile/
  // dimension/settings changes so it never answers for the wrong world.
  let probeGenerator: WorldGenerator = createGenerator(initial.profile, {
    seed: initial.seed,
    dimension: initial.dimension,
    settings: initial.settings,
  });

  const hover = mountHoverReadout({
    container: readoutEl,
    probe: (x, z) => probeGenerator.probeFast?.(x, z) ?? probeGenerator.probe(x, z),
    requestProbe: (x, z) => pool.requestProbe(x, z),
    cancelProbe: (id) => pool.cancel(id),
    showRegionDebug: () => store.getState().enabledLayers.includes('region-debug'),
    // The seasonal band in the readout depends on this world setting, so it has to be live.
    temperatureScale: () => Number(store.getState().settings?.temperatureScale ?? 20_000),
  });

  /**
   * Nearest waypoint whose marker covers a screen point, or null. Screen space, not block space, so
   * the grab area stays the same size at every zoom -- matching how the marker itself is drawn.
   */
  function waypointAt(screen: { x: number; y: number }): Waypoint | null {
    const state = store.getState();
    const camera = { centerX: state.centerX, centerZ: state.centerZ, zoom: state.zoom };
    let nearest: Waypoint | null = null;
    let nearestDistance = WAYPOINT_HIT_RADIUS_PX;
    for (const waypoint of state.waypoints ?? []) {
      const at = blockToScreen(
        camera,
        mapCanvas.viewportWidth,
        mapCanvas.viewportHeight,
        waypoint.x,
        waypoint.z,
      );
      const distance = Math.max(Math.abs(at.x - screen.x), Math.abs(at.y - screen.y));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = waypoint;
      }
    }
    return nearest;
  }

  /** A measure end at this screen point, snapped to a waypoint when one is close enough. */
  function measurePointAt(
    block: { x: number; z: number },
    screen: { x: number; y: number },
  ): MeasurePoint {
    const snapped = waypointAt(screen);
    if (snapped) {
      return {
        x: snapped.x,
        z: snapped.z,
        ...(snapped.label === '' ? {} : { label: snapped.label }),
      };
    }
    return { x: Math.round(block.x), z: Math.round(block.z) };
  }

  mapCanvas = new MapCanvas({
    canvas: canvasEl,
    getCamera: () => {
      const state = store.getState();
      return { centerX: state.centerX, centerZ: state.centerZ, zoom: state.zoom };
    },
    setCamera: (camera) => {
      store.setState({ centerX: camera.centerX, centerZ: camera.centerZ, zoom: camera.zoom });
    },
    onHover: (block, screen) => {
      hover.show(block);
      hover.follow(screen);
      if (block && screen) measurePanel?.trackCursor(measurePointAt(block, screen));
    },
    onFrame: (ctx, width, height, camera) => {
      const state = store.getState();
      const tokens = getThemeTokens();
      // `minerals` is a vector overlay (no `RasterLayer` registration), never fed into the raster
      // tile loop -- see `PaintOptions.showDeposits`'s doc comment.
      // An inactive filter dims nothing; requesting it anyway cost one worker job, one ImageBitmap
      // and one cache slot per visible tile, for a transparent square.
      const filterActive = isFilterActive(state.filter);
      const rasterLayers = state.enabledLayers.filter(
        (id) =>
          id !== 'grid' &&
          id !== 'minerals' &&
          id !== 'structures' &&
          (id !== 'filter' || filterActive),
      );
      const showDeposits = state.enabledLayers.includes('minerals');
      const showStructures = state.enabledLayers.includes('structures');
      let structures: readonly StructureFeature[] = [];
      let deposits: readonly DepositFeature[] = [];
      if (showStructures) {
        const bpp = blocksPerPixel(camera.zoom);
        const halfW = (width / 2) * bpp;
        const halfH = (height / 2) * bpp;
        const structureFilter = state.structureFilter ?? [];
        structures = features
          .structuresInView(camera.centerX - halfW, camera.centerZ - halfH, camera.centerX + halfW, camera.centerZ + halfH)
          .filter((s) => structureFilter.length === 0 || structureFilter.includes(structureSetOf(s.id)));
      }
      if (showDeposits) {
        const bpp = blocksPerPixel(camera.zoom);
        const halfW = (width / 2) * bpp;
        const halfH = (height / 2) * bpp;
        const minX = camera.centerX - halfW;
        const maxX = camera.centerX + halfW;
        const minZ = camera.centerZ - halfH;
        const maxZ = camera.centerZ + halfH;
        const oreFilter = state.oreFilter ?? [];
        // A vein type whose markers a real world almost never backs is not drawn at all: walking to
        // ore that is not there is the one failure that costs the map its credibility.
        const descriptor = listProfiles().find((p) => p.id === state.profile);
        const reliability = descriptor?.depositReliability;
        deposits = features
          .depositsInView(minX, minZ, maxX, maxZ, oreFilter)
          .filter((d) => matchesOreFilter(d.ore, oreFilter))
          .filter((d) => !veinIsUnreliable(reliability, veinFilterId(d.ore)))
          .filter((d) => meetsAccuracy(descriptor, d, state.minMarkerAccuracy ?? 0));
      }
      paintFrame({
        ctx,
        width,
        height,
        camera,
        layers: rasterLayers,
        showGrid: state.enabledLayers.includes('grid'),
        tiles,
        palette: tokens.colors,
        ...(tokens.alphas ? { alphas: tokens.alphas } : {}),
        layerOpacity: state.layerOpacity,
        filter: state.filter,
        showDeposits,
        deposits,
        showStructures,
        structures,
        completedStructures,
        // Sharper relief waits while features load: a pin you asked for beats a nicer picture.
        refine: !features.isPending(),
        waypoints: state.waypoints ?? [],
        ...(measurePanel ? { measure: measurePanel.ends() } : {}),
      });

      // Features after the paint, not before: painting is what requests this frame's tiles, so only
      // now does "no tiles pending" really mean the map is loaded. Checked before the paint, a fresh
      // view always looked idle and minerals jumped ahead of the biomes.
      if ((showStructures || showDeposits) && tiles.pendingLayers().length === 0) {
        const bpp = blocksPerPixel(camera.zoom);
        const halfW = (width / 2) * bpp;
        const halfH = (height / 2) * bpp;
        const box = [camera.centerX - halfW, camera.centerZ - halfH, camera.centerX + halfW, camera.centerZ + halfH] as const;
        if (showStructures) features.ensureVisible(...box, 'structures');
        if (showDeposits) features.ensureVisible(...box, 'deposits', state.oreFilter ?? []);
      }
    },
    grabAt: (screen) => waypointAt(screen)?.id ?? null,
    onGrabMove: (id, block) => {
      // Preview only: `setList(..., false)` skips persistence, so a drag does not write to storage
      // on every pointer move. The drop below is what persists.
      const list = (store.getState().waypoints ?? []).map((w) =>
        w.id === id ? { ...w, x: Math.round(block.x), z: Math.round(block.z) } : w,
      );
      waypointController.setList(list, false);
    },
    onGrabEnd: (id, block) => {
      waypointController.update(id, { x: Math.round(block.x), z: Math.round(block.z) });
    },
    onClick: (block, clickScreen) => {
      if (hover.isPinned()) {
        hover.unpin();
        return;
      }
      if (measurePanel?.isMeasuring()) {
        measurePanel.addPoint(measurePointAt(block, clickScreen));
        return;
      }
      if (waypointPanel?.isPlacing()) {
        waypointPanel.placeAt(block.x, block.z);
        return;
      }
      // A click on a marker selects it for renaming rather than pinning the readout under it.
      const hitWaypoint = waypointAt(clickScreen);
      if (hitWaypoint) {
        waypointPanel?.select(hitWaypoint.id);
        return;
      }
      const state = store.getState();
      // A click always pins the readout at that point; a marker under it just adds its details.
      hover.pin(block, clickScreen);
      const camera = { centerX: state.centerX, centerZ: state.centerZ, zoom: state.zoom };
      const bpp = blocksPerPixel(camera.zoom);
      const halfW = (mapCanvas.viewportWidth / 2) * bpp;
      const halfH = (mapCanvas.viewportHeight / 2) * bpp;
      if (state.enabledLayers.includes('structures')) {
        const structureFilter = state.structureFilter ?? [];
        const visible = features
          .structuresInView(camera.centerX - halfW, camera.centerZ - halfH, camera.centerX + halfW, camera.centerZ + halfH)
          .filter((s) => structureFilter.length === 0 || structureFilter.includes(structureSetOf(s.id)));
        // The same grouping the painter drew, so the click lands on exactly what is on screen.
        const clusters = clusterStructures(
          visible,
          (x, z) => blockToScreen(camera, mapCanvas.viewportWidth, mapCanvas.viewportHeight, x, z),
          STRUCTURE_MARKER_PX,
        );
        let hit: StructureCluster | null = null;
        let hitDistance = STRUCTURE_MARKER_PX / 2 + 3;
        for (const cluster of clusters) {
          const distance = Math.hypot(cluster.screenX - clickScreen.x, cluster.screenY - clickScreen.y);
          if (distance < hitDistance) {
            hitDistance = distance;
            hit = cluster;
          }
        }
        if (hit && hit.members.length > 1) {
          // A group: zoom in on it, two steps, so it splits into its members.
          hover.unpin();
          store.setState({ centerX: hit.x, centerZ: hit.z, zoom: Math.max(MIN_ZOOM, state.zoom - 2) });
          return;
        }
        const single = hit?.members[0];
        if (single) {
          const world = { seed: state.seed, profile: state.profile };
          hover.selectStructure(single, {
            completed: () => completedStructures.has(single.id),
            toggle: () => {
              if (completedStructures.has(single.id)) completedStructures.delete(single.id);
              else completedStructures.add(single.id);
              void saveCompletedStructures(storage, world.seed, world.profile, [...completedStructures]).catch(() => {});
              mapCanvas.requestFrame();
            },
          });
          return;
        }
      }
      hover.selectStructure(null);
      if (!state.enabledLayers.includes('minerals')) return;
      const oreFilter = state.oreFilter ?? [];
      // The filter has to go in, not just be applied after: with an ore selected, only that ore's
      // per-region cache is populated, and asking for "everything" reads a whole-region entry that
      // was never fetched. Clicks then hit nothing at all -- reported 12 Sep.
      const all = features.depositsInView(
        camera.centerX - halfW,
        camera.centerZ - halfH,
        camera.centerX + halfW,
        camera.centerZ + halfH,
        oreFilter,
      );
      const clickDescriptor = listProfiles().find((p) => p.id === state.profile);
      const visible = all
        .filter((d) => matchesOreFilter(d.ore, oreFilter))
        .filter((d) => !veinIsUnreliable(clickDescriptor?.depositReliability, veinFilterId(d.ore)))
        .filter((d) => meetsAccuracy(clickDescriptor, d, state.minMarkerAccuracy ?? 0));
      // Nearest marker within a fixed on-screen radius (screen space, not block space, so the hit
      // area stays the same size on screen at every zoom, matching `DEPOSIT_MARKER_RADIUS_PX`).
      let nearest: DepositFeature | null = null;
      let nearestDistance = 12; // px -- a bit more forgiving than the marker's own drawn radius.
      for (const deposit of visible) {
        const screen = blockToScreen(
          camera,
          mapCanvas.viewportWidth,
          mapCanvas.viewportHeight,
          deposit.x,
          deposit.z,
        );
        const distance = Math.hypot(screen.x - clickScreen.x, screen.y - clickScreen.y);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = deposit;
        }
      }
      hover.selectDeposit(nearest);
    },
  });

  let waypointWorldKey = `${initial.seed.toString()}:${initial.profile}`;
  let waypointLoadVersion = 0;
  let persistedProfile = initial.profile;
  let persistedSeed = initial.seed;
  store.subscribe((state) => {
    if (state.profile !== persistedProfile) {
      persistedProfile = state.profile;
      void saveProfilePreference(storage, state.profile).catch(() => {});
    }
    if (state.seed !== persistedSeed) {
      persistedSeed = state.seed;
      void saveSeedPreference(storage, state.seed).catch(() => {});
    }
    const nextWaypointWorldKey = `${state.seed.toString()}:${state.profile}`;
    if (nextWaypointWorldKey !== waypointWorldKey) {
      waypointWorldKey = nextWaypointWorldKey;
      const version = ++waypointLoadVersion;
      waypointController.setList([], false);
      void loadWaypoints(storage, state.seed, state.profile).then((loaded) => {
        if (version === waypointLoadVersion) waypointController.setList(loaded, false);
      });
      completedStructures = new Set();
      void loadCompletedStructures(storage, state.seed, state.profile)
        .then((ids) => {
          if (version === waypointLoadVersion) {
            completedStructures = new Set(ids);
            mapCanvas.requestFrame();
          }
        })
        .catch(() => {});
    }
    const key = mapSessionKey(state);
    if (key !== sessionKey) {
      sessionKey = key;
      hover.show(null);
      hover.selectDeposit(null);
      hover.selectStructure(null);
      tiles.setSession(state.seed, state.profile, state.dimension, state.settings);
      features.setSession(state.seed, state.profile, state.dimension);
      probeGenerator = createGenerator(state.profile, {
        seed: state.seed,
        dimension: state.dimension,
        settings: state.settings,
      });
    } else if (state.filter !== filterRef) {
      // Compared by reference first: this runs on every pan frame, and the filter only gets a new
      // object when someone edits it.
      const nextFilterKey = JSON.stringify(state.filter);
      if (nextFilterKey !== filterKey) {
        tiles.invalidateLayer('filter');
      }
    }
    if (state.filter !== filterRef) {
      filterRef = state.filter;
      filterKey = JSON.stringify(state.filter);
    }
    mapCanvas.requestFrame();
  });

  onThemeChange(() => {
    // Tile bitmaps bake in theme colours (ADR 0005): a theme change invalidates the cache.
    tiles.clearAll();
    mapCanvas.requestFrame();
  });

  if (sidePanel) {
    sidePanel.replaceChildren();

    // Seed, profile and dimension share one row: three short controls, each of which was taking a
    // full panel's height at the top of the side panel where space is scarcest.
    const worldSection = document.createElement('section');
    worldSection.className = 'panel world-row';
    const seedSection = document.createElement('div');
    seedSection.className = 'world-row__field world-row__field--seed';
    mountSeedInput(seedSection, store);

    const profileSection = document.createElement('div');
    profileSection.className = 'world-row__field';
    mountProfileSelect(profileSection, store);

    const dimensionSection = document.createElement('div');
    dimensionSection.className = 'world-row__field';
    mountDimensionSelect(dimensionSection, store);
    worldSection.append(seedSection, profileSection, dimensionSection);

    // Every configuration section collapses, and remembers whether it was left open
    // (docs/PLAN.md 10c P2). Seed, profile and dimension stay uncollapsed: they are single
    // controls, and hiding them behind a disclosure costs more than it saves.
    const configSection = document.createElement('section');
    configSection.className = 'panel';

    mountCollapsibleSection({
      parent: configSection,
      key: 'waypoints',
      storage,
      defaultOpen: true,
      fallbackTitle: en.waypoints.heading,
      build: (body) => {
        waypointPanel = mountWaypointPanel({
          container: body,
          store,
          controller: waypointController,
          centerOn: (waypoint) => {
            store.setState({ centerX: waypoint.x, centerZ: waypoint.z });
          },
        });
      },
    });

    mountCollapsibleSection({
      parent: configSection,
      key: 'layers',
      storage,
      defaultOpen: true,
      fallbackTitle: en.layers.heading,
      build: (body) => mountLayerPanel(body, store),
    });

    mountCollapsibleSection({
      parent: configSection,
      key: 'filter',
      storage,
      defaultOpen: true,
      fallbackTitle: en.filter.heading,
      build: (body) => mountFilterPanel(body, store),
    });

    mountCollapsibleSection({
      parent: configSection,
      key: 'measure',
      storage,
      defaultOpen: true,
      fallbackTitle: en.measure.heading,
      build: (body) => {
        measurePanel = mountMeasurePanel({
          container: body,
          onChange: () => mapCanvas.requestFrame(),
        });
      },
    });



    // Advanced last: it is the section a player needs least often, and it already carries its own
    // persisted disclosure, so it is not wrapped in a second one.
    const settingsSection = document.createElement('section');
    settingsSection.className = 'panel';
    mountWorldSettings(settingsSection, store);

    // The ad sits right under the world row, where a player looks first, and is absent from a build
    // without ads. The disclaimer the Minecraft Usage Guidelines ask of fan sites closes the panel.
    sidePanel.append(worldSection);
    mountAdSlot(sidePanel, 'map');
    const disclaimer = document.createElement('p');
    disclaimer.className = 'site-disclaimer';
    disclaimer.textContent = en.disclaimer;
    sidePanel.append(configSection, settingsSection, disclaimer);
  }

  const mainEl = document.querySelector('.app-main');
  if (mainEl) {
    const scaleEl = document.createElement('div');
    mainEl.append(scaleEl);
    const scaleBar = mountScaleBar(scaleEl, () => store.getState().zoom);
    store.subscribe(() => scaleBar.update());
  }

  mapCanvas.requestFrame();

  // Canvas text does not re-layout when a webfont arrives, so a first paint that beat Silkscreen
  // would keep its fallback until the next pan. One repaint when the face is ready fixes it.
  void document.fonts?.ready.then(() => mapCanvas.requestFrame());
}

void boot();

export {};
