import { describe, expect, it } from 'vitest';
import type { Palette } from '../render';
import { parsePalette } from './renderer';

const PALETTE: Palette = {
  bg: '#000000',
  grid: '#ffffff',
  wall: '#ff0000',
  twoSided: '#00ff00',
  secret: '#0000ff',
  lineTeleport: '#123456',
  lineSectorSecret: '#abcdef',
  lineSectorDamage: '#7f7f7f',
  things: {
    monsters: '#ff375f',
    coop: '#2f9e50',
    deathmatch: '#ff8fa3',
    weapons: '#ff9f0a',
    ammo: '#c8a765',
    health: '#63e6be',
    powerups: '#bf5af2',
    keys: '#64d2ff',
    teleports: '#5e5ce6',
    decorations: '#8e8e93',
    other: '#c7c7cc',
  },
  player: '#34c759',
};

/** `#rrggbb` parsed by hand, for comparison against `parsePalette`'s output. */
function expectedRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

describe('parsePalette', () => {
  it('parses primary hex colors to exact 0/1 floats', () => {
    const gl = parsePalette(PALETTE);
    expect(gl.bg).toEqual([0, 0, 0]);
    expect(gl.grid).toEqual([1, 1, 1]);
    expect(gl.wall).toEqual([1, 0, 0]);
    expect(gl.twoSided).toEqual([0, 1, 0]);
    expect(gl.secret).toEqual([0, 0, 1]);
  });

  it('parses every non-things field to its hex value divided by 255', () => {
    const gl = parsePalette(PALETTE);
    const fields = ['lineTeleport', 'lineSectorSecret', 'lineSectorDamage', 'player'] as const;
    for (const field of fields) {
      const [r, g, b] = expectedRgb(PALETTE[field]);
      expect(gl[field][0]).toBeCloseTo(r);
      expect(gl[field][1]).toBeCloseTo(g);
      expect(gl[field][2]).toBeCloseTo(b);
    }
  });

  it('covers every thing-category color, with no category dropped or added', () => {
    const gl = parsePalette(PALETTE);
    expect(Object.keys(gl.things).sort()).toEqual(Object.keys(PALETTE.things).sort());
    for (const [category, hex] of Object.entries(PALETTE.things)) {
      const [r, g, b] = expectedRgb(hex);
      const actual = gl.things[category as keyof typeof gl.things];
      expect(actual[0]).toBeCloseTo(r);
      expect(actual[1]).toBeCloseTo(g);
      expect(actual[2]).toBeCloseTo(b);
    }
  });

  it('is a pure function: the same input yields equal, independent output', () => {
    const a = parsePalette(PALETTE);
    const b = parsePalette(PALETTE);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.things).not.toBe(b.things);
  });
});
