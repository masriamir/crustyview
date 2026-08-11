import { describe, it, expect } from 'vitest';
import {
  GRID_SIZES,
  DEFAULT_GRID_SIZE,
  stepGridSize,
  isGridSize,
  MIN_GRID_PX,
  effectiveGridSize,
  gridLabel,
  type GridSize,
} from './grid';

describe('grid ladder', () => {
  it('is the Doom Builder power-of-two ladder with a 32 default', () => {
    expect(GRID_SIZES).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512]);
    expect(DEFAULT_GRID_SIZE).toBe(32);
  });
});

describe('stepGridSize', () => {
  it('steps up and down', () => {
    expect(stepGridSize(32, 1)).toBe(64);
    expect(stepGridSize(64, -1)).toBe(32);
  });

  it('clamps at both ends', () => {
    expect(stepGridSize(1, -1)).toBe(1);
    expect(stepGridSize(512, 1)).toBe(512);
  });

  it('walks the full ladder in both directions', () => {
    let up: GridSize = 1;
    for (const expected of GRID_SIZES.slice(1)) {
      up = stepGridSize(up, 1);
      expect(up).toBe(expected);
    }
    let down: GridSize = 512;
    for (const expected of [...GRID_SIZES].reverse().slice(1)) {
      down = stepGridSize(down, -1);
      expect(down).toBe(expected);
    }
  });
});

describe('isGridSize', () => {
  it('accepts every ladder member', () => {
    for (const size of GRID_SIZES) expect(isGridSize(size)).toBe(true);
  });

  it('rejects non-members and non-numbers', () => {
    for (const value of [0, -1, 33, 1024, '32', null, undefined, true, {}]) {
      expect(isGridSize(value)).toBe(false);
    }
  });
});

describe('effectiveGridSize', () => {
  it('returns the base when it already clears the floor', () => {
    expect(effectiveGridSize(32, 1)).toBe(32);
    // Exactly at the floor counts as clearing it: 32 * 0.25 === MIN_GRID_PX.
    expect(effectiveGridSize(32, MIN_GRID_PX / 32)).toBe(32);
  });

  it('coarsens up the ladder until the spacing clears the floor', () => {
    // 32*0.1=3.2 and 64*0.1=6.4 are too dense; 128*0.1=12.8 clears.
    expect(effectiveGridSize(32, 0.1)).toBe(128);
    // 1, 2 and 4 are too dense at scale 1; 8*1=8 clears exactly.
    expect(effectiveGridSize(1, 1)).toBe(8);
  });

  it('anchors on a real map: Eviternity MAP29 at fit zoom', () => {
    // 28176x29952 map units in a 1200x800 viewport with a 24px margin gives
    // fitScale 0.0251, at which the chosen 32 grid draws as 512 — the top of
    // the ladder — at fit zoom. Measured, not chosen (#76).
    expect(effectiveGridSize(32, 0.0251)).toBe(512);
  });

  it('returns null when even the largest ladder member is too dense', () => {
    expect(effectiveGridSize(32, 0.01)).toBeNull(); // 512 * 0.01 = 5.12 < 8
    expect(effectiveGridSize(512, 0.001)).toBeNull();
  });

  it('never returns a size below the base', () => {
    expect(effectiveGridSize(512, 1)).toBe(512);
    expect(effectiveGridSize(256, 1)).toBe(256);
    // A base that already clears is returned as-is even though finer members exist.
    expect(effectiveGridSize(256, 10)).toBe(256);
  });

  it('returns null for a scale that is NaN, zero, or negative', () => {
    for (const scale of [Number.NaN, 0, -1, -0.5]) {
      expect(effectiveGridSize(32, scale)).toBeNull();
    }
  });

  it('handles infinite scale without a Number.isFinite guard', () => {
    // Deliberately unguarded: an infinite scale returns the base, exactly as the
    // density guard this replaced did. Pinned so a refactor cannot drift it.
    expect(effectiveGridSize(32, Number.POSITIVE_INFINITY)).toBe(32);
    expect(effectiveGridSize(32, Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('gridLabel', () => {
  it('shows the plain size before the first draw (drawn undefined)', () => {
    expect(gridLabel(32, undefined)).toBe('32');
  });

  it('shows the plain size when drawn as chosen', () => {
    expect(gridLabel(32, 32)).toBe('32');
  });

  it('shows the plain size, not an arrow, when drawn is stale-finer than base (#76 regression)', () => {
    // Reproduces the momentary state a synchronous `]` keypress produces before
    // the rAF draw catches up: `mapPrefs.gridSize` is already 64 but
    // `drawnGridSize` still holds the previous draw's 32. This must render as
    // plain "64", never as the impossible "64→32". This case would fail against
    // the old `drawn === base` (`===`) logic, which falls through to the arrow arm.
    expect(gridLabel(64, 32)).toBe('64');
  });

  it('shows the arrow form when drawn is coarser than base', () => {
    expect(gridLabel(32, 128)).toBe('32→128');
  });

  it('shows the zoom-in hint when drawn is null', () => {
    expect(gridLabel(32, null)).toBe('32 · zoom in');
  });
});
