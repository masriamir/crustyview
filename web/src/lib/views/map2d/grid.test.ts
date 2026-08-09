import { describe, it, expect } from 'vitest';
import { GRID_SIZES, DEFAULT_GRID_SIZE, stepGridSize, isGridSize, type GridSize } from './grid';

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
