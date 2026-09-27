/**
 * Canvas viewport: drag to pan, wheel to zoom (cursor-anchored, integer zoom exponents), keyboard
 * arrows to nudge, devicePixelRatio-aware so it stays pixel-crisp, resizes with its container.
 * Delegates all coordinate math to src/core/coords/coords.ts.
 */
import type { Camera } from '@core/coords/coords';
import { MAX_ZOOM, MIN_ZOOM, blocksPerPixel, screenToBlock, zoomAround } from '@core/coords/coords';

export interface MapCanvasOptions {
  readonly canvas: HTMLCanvasElement;
  readonly getCamera: () => Camera;
  readonly setCamera: (camera: Camera) => void;
  readonly onHover: (
    block: { x: number; z: number } | null,
    screen: { x: number; y: number } | null,
  ) => void;
  readonly onFrame: (ctx: CanvasRenderingContext2D, width: number, height: number, camera: Camera) => void;
  /** A genuine click (pointer moved less than `CLICK_MOVE_THRESHOLD_PX` between down and up), in
   * both block and screen space -- callers that hit-test against on-screen markers (e.g. deposit
   * pins, drawn in screen space by the painter) need the screen point, not just the block one, to
   * do their own pixel-radius search. Never fired for a drag-end. Optional: a caller with nothing
   * clickable (yet) simply omits it. */
  readonly onClick?: (block: { x: number; z: number }, screen: { x: number; y: number }) => void;
  /**
   * Hit test for draggable overlay items (waypoint markers). Returning an id from a pointerdown
   * grabs that item for the rest of the gesture instead of panning the map.
   */
  readonly grabAt?: (screen: { x: number; y: number }) => string | null;
  /** Called on every move of a grabbed item. Preview only -- do not persist per frame. */
  readonly onGrabMove?: (id: string, block: { x: number; z: number }) => void;
  /** Called once when a grabbed item is dropped somewhere new. This is the one to persist. */
  readonly onGrabEnd?: (id: string, block: { x: number; z: number }) => void;
  /** Blocks moved per arrow-key press at zoom 0; scales with zoom like everything else. */
  readonly keyStepBlocks?: number;
}

/** Pointer movement, in CSS pixels, below which a pointerdown/pointerup pair still counts as a
 * click rather than a drag -- small enough that an intentional drag of even a few blocks at deep
 * zoom is never misread as a click, generous enough that a hand that is not perfectly still during
 * a deliberate click is not penalised for it. */
const CLICK_MOVE_THRESHOLD_PX = 4;

export class MapCanvas {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: MapCanvasOptions;
  private readonly resizeObserver: ResizeObserver;
  private width = 0;
  private height = 0;
  private dragging = false;
  /** Id of the overlay item under the pointer for this gesture, or null when panning. */
  private grabbed: string | null = null;
  private lastClientX = 0;
  private lastClientY = 0;
  private pointerDownClientX = 0;
  private pointerDownClientY = 0;
  private frameQueued = false;

  constructor(opts: MapCanvasOptions) {
    this.opts = opts;
    this.canvas = opts.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    this.ctx = ctx;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    this.attachPointerEvents();
    this.attachKeyboardEvents();
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  requestFrame(): void {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.draw();
    });
  }

  dispose(): void {
    this.resizeObserver.disconnect();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.requestFrame();
  }

  private draw(): void {
    const camera = this.opts.getCamera();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.opts.onFrame(this.ctx, this.width, this.height, camera);
  }

  private screenPointOf(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private attachPointerEvents(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.lastClientX = e.clientX;
      this.lastClientY = e.clientY;
      this.pointerDownClientX = e.clientX;
      this.pointerDownClientY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      // A pointer that lands on something grabbable (a waypoint marker) drags *it*, not the map --
      // otherwise moving a marker would pan the world out from under it.
      this.grabbed = this.opts.grabAt?.(this.screenPointOf(e)) ?? null;
      this.dragging = this.grabbed === null;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.grabbed !== null) {
        const { x: gx, y: gy } = this.screenPointOf(e);
        this.opts.onGrabMove?.(
          this.grabbed,
          screenToBlock(this.opts.getCamera(), this.width, this.height, gx, gy),
        );
        this.requestFrame();
        return;
      }
      if (this.dragging) {
        const camera = this.opts.getCamera();
        const bpp = blocksPerPixel(camera.zoom);
        const dx = e.clientX - this.lastClientX;
        const dy = e.clientY - this.lastClientY;
        this.lastClientX = e.clientX;
        this.lastClientY = e.clientY;
        this.opts.setCamera({
          centerX: camera.centerX - dx * bpp,
          centerZ: camera.centerZ - dy * bpp,
          zoom: camera.zoom,
        });
        this.requestFrame();
      }
      const { x: sx, y: sy } = this.screenPointOf(e);
      const block = screenToBlock(this.opts.getCamera(), this.width, this.height, sx, sy);
      this.opts.onHover(block, { x: sx, y: sy });
    });

    this.canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
      const moved = Math.hypot(e.clientX - this.pointerDownClientX, e.clientY - this.pointerDownClientY);
      if (this.grabbed !== null) {
        const { x: gx, y: gy } = this.screenPointOf(e);
        const dropped = this.grabbed;
        this.grabbed = null;
        // A grab that never moved is a click on the marker, not a drag: report it as a drop only
        // when it actually went somewhere, so selecting a marker does not rewrite its coordinates.
        if (moved >= CLICK_MOVE_THRESHOLD_PX) {
          this.opts.onGrabEnd?.(
            dropped,
            screenToBlock(this.opts.getCamera(), this.width, this.height, gx, gy),
          );
          return;
        }
      }
      if (moved < CLICK_MOVE_THRESHOLD_PX && this.opts.onClick) {
        const screen = this.screenPointOf(e);
        const block = screenToBlock(this.opts.getCamera(), this.width, this.height, screen.x, screen.y);
        this.opts.onClick(block, screen);
      }
    });

    this.canvas.addEventListener('pointercancel', () => {
      this.dragging = false;
      this.grabbed = null;
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.opts.onHover(null, null);
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const { x: sx, y: sy } = this.screenPointOf(e);
        const camera = this.opts.getCamera();
        const delta = e.deltaY > 0 ? 1 : -1;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom + delta));
        if (newZoom === camera.zoom) return;
        this.opts.setCamera(zoomAround(camera, this.width, this.height, sx, sy, newZoom));
        this.requestFrame();
      },
      { passive: false },
    );
  }

  private attachKeyboardEvents(): void {
    this.canvas.tabIndex = 0;
    this.canvas.addEventListener('keydown', (e) => {
      const camera = this.opts.getCamera();
      const bpp = blocksPerPixel(camera.zoom);
      const step = bpp * (this.opts.keyStepBlocks ?? 32);
      let { centerX, centerZ } = camera;
      switch (e.key) {
        case 'ArrowLeft':
          centerX -= step;
          break;
        case 'ArrowRight':
          centerX += step;
          break;
        case 'ArrowUp':
          centerZ -= step;
          break;
        case 'ArrowDown':
          centerZ += step;
          break;
        default:
          return;
      }
      e.preventDefault();
      this.opts.setCamera({ centerX, centerZ, zoom: camera.zoom });
      this.requestFrame();
    });
  }
}
