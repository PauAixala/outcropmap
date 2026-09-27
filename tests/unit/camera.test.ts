import { describe, expect, it } from 'vitest';
import {
  blockToScreen,
  blocksPerPixel,
  screenToBlock,
  zoomAround,
} from '../../src/core/coords/coords';
import type { Camera } from '../../src/core/coords/coords';

describe('camera transforms', () => {
  const camera: Camera = { centerX: 100, centerZ: -50, zoom: 2 };

  it('round-trips screen <-> block through the canvas centre', () => {
    const width = 800;
    const height = 600;
    const centreBlock = screenToBlock(camera, width, height, width / 2, height / 2);
    expect(centreBlock.x).toBe(camera.centerX);
    expect(centreBlock.z).toBe(camera.centerZ);

    const backToScreen = blockToScreen(camera, width, height, centreBlock.x, centreBlock.z);
    expect(backToScreen.x).toBeCloseTo(width / 2);
    expect(backToScreen.y).toBeCloseTo(height / 2);
  });

  it('scales screen deltas by blocksPerPixel', () => {
    const width = 800;
    const height = 600;
    const bpp = blocksPerPixel(camera.zoom);
    const a = screenToBlock(camera, width, height, 0, 0);
    const b = screenToBlock(camera, width, height, 10, 0);
    expect(b.x - a.x).toBeCloseTo(10 * bpp);
  });

  it('keeps the world point under the cursor fixed when zooming around it', () => {
    const width = 800;
    const height = 600;
    const cursorX = 300;
    const cursorY = 200;
    const before = screenToBlock(camera, width, height, cursorX, cursorY);

    const zoomedIn = zoomAround(camera, width, height, cursorX, cursorY, camera.zoom - 1);
    const afterIn = screenToBlock(zoomedIn, width, height, cursorX, cursorY);
    expect(afterIn.x).toBeCloseTo(before.x);
    expect(afterIn.z).toBeCloseTo(before.z);
    expect(zoomedIn.zoom).toBe(camera.zoom - 1);

    const zoomedOut = zoomAround(camera, width, height, cursorX, cursorY, camera.zoom + 3);
    const afterOut = screenToBlock(zoomedOut, width, height, cursorX, cursorY);
    expect(afterOut.x).toBeCloseTo(before.x);
    expect(afterOut.z).toBeCloseTo(before.z);
  });

  it('clamps zoom to the declared range', () => {
    const width = 800;
    const height = 600;
    const zoomedFar = zoomAround(camera, width, height, 0, 0, 999);
    expect(zoomedFar.zoom).toBeLessThanOrEqual(10);
    const zoomedClose = zoomAround(camera, width, height, 0, 0, -999);
    expect(zoomedClose.zoom).toBeGreaterThanOrEqual(-4);
  });
});
