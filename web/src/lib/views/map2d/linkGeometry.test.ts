/**
 * Pure geometry for the teleport-link treatment (#66), extracted from
 * render.ts so both renderers share one source (#175). The values under test
 * are shipped treatment decisions, not arbitrary: bow 0.18/42 (#66), the
 * endpoint cull rule (#162), the pad sum that sizes the tile apron (#153).
 */
import { describe, expect, it } from 'vitest';
import {
  LINK_ARROW_SIZE,
  LINK_ARROW_SPREAD,
  LINK_BOW_MAX,
  LINK_CULL_PAD_PX,
  LINK_RING_RADIUS,
  arrowHeadPoints,
  linkControlPoint,
  visibleLinks,
} from './linkGeometry';
import { viewportRect } from './cull';

describe('linkControlPoint', () => {
  it('bows perpendicular to the chord midpoint', () => {
    const control = linkControlPoint({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(control.x).toBeCloseTo(5);
    expect(control.y).toBeCloseTo(1.8); // len 10 · ratio 0.18, below the chord in screen space
  });

  it('caps the bow at LINK_BOW_MAX on long chords', () => {
    const control = linkControlPoint({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(control.y).toBeCloseTo(LINK_BOW_MAX);
  });

  it('keeps one handedness, so co-destination arcs fan apart', () => {
    const forward = linkControlPoint({ x: 0, y: 0 }, { x: 10, y: 0 });
    const backward = linkControlPoint({ x: 10, y: 0 }, { x: 0, y: 0 });
    expect(forward.y).toBeCloseTo(1.8);
    expect(backward.y).toBeCloseTo(-1.8);
  });

  it('degrades a zero-length link to its own point', () => {
    const control = linkControlPoint({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(control).toEqual({ x: 5, y: 5 });
  });
});

describe('arrowHeadPoints', () => {
  it('places both barbs LINK_ARROW_SIZE behind the tip at ±LINK_ARROW_SPREAD', () => {
    const [a, b] = arrowHeadPoints({ x: 10, y: 0 }, { x: 0, y: 0 });
    for (const [barb, spread] of [
      [a, -LINK_ARROW_SPREAD],
      [b, LINK_ARROW_SPREAD],
    ] as const) {
      expect(barb.x).toBeCloseTo(10 - LINK_ARROW_SIZE * Math.cos(spread));
      expect(barb.y).toBeCloseTo(-LINK_ARROW_SIZE * Math.sin(spread));
    }
  });
});

describe('LINK_CULL_PAD_PX', () => {
  it('is the sum of the three ink reaches', () => {
    expect(LINK_CULL_PAD_PX).toBe(LINK_BOW_MAX + LINK_ARROW_SIZE + LINK_RING_RADIUS);
  });
});

describe('visibleLinks', () => {
  // A 100×100 CSS-px view of map units 0..100 (scale 1, y flipped by ty=100),
  // padded like the draw pass pads it.
  const view = viewportRect({ scale: 1, tx: 0, ty: 100 }, 100, 100, LINK_CULL_PAD_PX);

  it('keeps a link with one endpoint on screen (#162)', () => {
    const links = [{ from: [50, 50] as [number, number], to: [5000, 5000] as [number, number] }];
    expect(visibleLinks(links, view)).toEqual(links);
  });

  it('drops a link whose two ends are both far off screen, chord crossing or not', () => {
    const links = [{ from: [-5000, 50] as [number, number], to: [5000, 50] as [number, number] }];
    expect(visibleLinks(links, view)).toEqual([]);
  });

  it('returns the input array unchanged when nothing is dropped', () => {
    const links = [
      { from: [10, 10] as [number, number], to: [20, 20] as [number, number] },
      { from: [30, 30] as [number, number], to: [40, 40] as [number, number] },
    ];
    expect(visibleLinks(links, view)).toBe(links);
  });
});
