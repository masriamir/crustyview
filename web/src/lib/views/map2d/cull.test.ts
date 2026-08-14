import { describe, it, expect } from 'vitest';
import { pointVisible, segmentVisible, viewportRect, type Rect } from './cull';
import type { Transform } from './transform';

/** Identity scale with no offset: screen (x, y) is map (x, -y). */
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

describe('viewportRect', () => {
  it('normalizes across the Y flip', () => {
    // Screen Y grows downward while map Y grows north, so the bottom of the
    // viewport is the SMALLEST map Y. A rect built without normalizing would
    // come out inverted and reject everything.
    const r = viewportRect(IDENTITY, 100, 50, 0);
    expect(r).toEqual({ minX: 0, maxX: 100, minY: -50, maxY: 0 });
  });

  it('inflates by the padding converted to map units', () => {
    const r = viewportRect(IDENTITY, 100, 50, 10);
    expect(r).toEqual({ minX: -10, maxX: 110, minY: -60, maxY: 10 });
  });

  it('covers less map at higher zoom, and scales the padding with it', () => {
    // At scale 2 the same viewport shows half the map, and 10 screen px is
    // only 5 map units.
    const r = viewportRect({ scale: 2, tx: 0, ty: 0 }, 100, 50, 10);
    expect(r).toEqual({ minX: -5, maxX: 55, minY: -30, maxY: 5 });
  });
});

describe('segmentVisible', () => {
  const view: Rect = { minX: 0, minY: -50, maxX: 100, maxY: 0 };

  it('keeps a segment that crosses the viewport with both ends outside', () => {
    // The whole reason this module exists. An endpoint-containment test drops
    // this line, and on a dense map that reads as nothing being wrong.
    expect(segmentVisible(view, -1000, -25, 1000, -25)).toBe(true);
  });

  it('keeps a segment with one endpoint inside', () => {
    expect(segmentVisible(view, 50, -25, 5000, -25)).toBe(true);
  });

  it.each([
    ['left', -1000, -25, -500, -25],
    ['right', 500, -25, 1000, -25],
    ['above', 10, 100, 50, 200],
    ['below', 10, -100, 50, -200],
  ])('rejects a segment entirely %s the viewport', (_side, x1, y1, x2, y2) => {
    // One case per edge: a sign error in a single outcode bit fails exactly
    // one of these rather than being masked by the others.
    expect(segmentVisible(view, x1, y1, x2, y2)).toBe(false);
  });

  it('is deliberately conservative near a corner', () => {
    // Both endpoints are outside but share no single edge, so the trivial
    // reject keeps this segment even though it never touches the rect. That
    // is by design — exact segment/rectangle intersection would cost more
    // arithmetic on every element than the few extra draws it saves. This
    // test exists so the behavior is not mistaken for a bug and "fixed".
    const small: Rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segmentVisible(small, -5, 30, 30, -5)).toBe(true);
  });
});

describe('pointVisible', () => {
  const view: Rect = { minX: 0, minY: -50, maxX: 100, maxY: 0 };

  it('accepts a point inside', () => {
    expect(pointVisible(view, 50, -25)).toBe(true);
  });

  it('accepts a point exactly on the boundary', () => {
    expect(pointVisible(view, 0, 0)).toBe(true);
    expect(pointVisible(view, 100, -50)).toBe(true);
  });

  it('rejects points outside on each axis', () => {
    expect(pointVisible(view, -1, -25)).toBe(false);
    expect(pointVisible(view, 101, -25)).toBe(false);
    expect(pointVisible(view, 50, 1)).toBe(false);
    expect(pointVisible(view, 50, -51)).toBe(false);
  });
});
