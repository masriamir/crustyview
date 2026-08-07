import { describe, it, expect } from 'vitest';
import { fitTransform, mapToScreen, screenToMap, zoomAt, panBy } from './transform';

const bounds = { min_x: 0, min_y: 0, max_x: 200, max_y: 100 };

describe('fitTransform', () => {
  it('fits and centers the bounds with the margin', () => {
    const t = fitTransform(bounds, 448, 248, 24);
    expect(t.scale).toBe(2); // limited by both axes equally: (448-48)/200 = (248-48)/100
    const tl = mapToScreen(t, 0, 100); // map top-left corner
    const br = mapToScreen(t, 200, 0);
    expect(tl).toEqual({ x: 24, y: 24 });
    expect(br).toEqual({ x: 424, y: 224 });
  });
  it('degenerate bounds fall back to scale 1 centered', () => {
    const t = fitTransform({ min_x: 5, min_y: 5, max_x: 5, max_y: 5 }, 100, 100, 24);
    expect(t.scale).toBe(1);
    expect(mapToScreen(t, 5, 5)).toEqual({ x: 50, y: 50 });
  });
});

describe('round-trip', () => {
  it('screenToMap inverts mapToScreen', () => {
    const t = fitTransform(bounds, 448, 248, 24);
    const p = screenToMap(t, 100, 60);
    expect(mapToScreen(t, p.x, p.y).x).toBeCloseTo(100);
    expect(mapToScreen(t, p.x, p.y).y).toBeCloseTo(60);
  });
});

describe('zoomAt', () => {
  it('keeps the anchor point fixed and clamps scale', () => {
    const t = fitTransform(bounds, 448, 248, 24);
    const before = screenToMap(t, 100, 60);
    const z = zoomAt(t, 100, 60, 1.1, 0.2, 40);
    const after = screenToMap(z, 100, 60);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(t, 0, 0, 1e9, 0.2, 40).scale).toBe(40);
    expect(zoomAt(t, 0, 0, 1e-9, 0.2, 40).scale).toBe(0.2);
  });
});

describe('panBy', () => {
  it('offsets by screen pixels', () => {
    const t = { scale: 2, tx: 10, ty: 20 };
    expect(panBy(t, 5, -3)).toEqual({ scale: 2, tx: 15, ty: 17 });
  });
});
