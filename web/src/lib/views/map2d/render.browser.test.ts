import { describe, it, expect } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { drawMapLayers, type Palette } from './render';
import type { Transform } from './transform';

/**
 * The draw passes used to close over the component's `width`/`height` to build
 * their cull rect. Rendering into a tile means running them against a second
 * surface with its own dimensions, so those are parameters now — and a pass
 * that missed the change would still look right in the app while quietly
 * culling against the wrong rect on the tile (#152).
 */
const PALETTE: Palette = {
  bg: '#000000',
  grid: '#222222',
  wall: '#ff0000',
  twoSided: '#888888',
  secret: '#ffff00',
  lineTeleport: '#00ffff',
  lineSectorSecret: '#ff00ff',
  lineSectorDamage: '#ff8800',
  things: {
    monsters: '#ff0000',
    coop: '#00ff00',
    deathmatch: '#ff00ff',
    weapons: '#ffaa00',
    ammo: '#aa8844',
    health: '#00ffaa',
    powerups: '#aa00ff',
    keys: '#00aaff',
    teleports: '#4444ff',
    decorations: '#888888',
    other: '#cccccc',
  },
  player: '#00ff00',
};

/** Identity scale, no offset: map (x, y) draws at screen (x, -y). */
const T: Transform = { scale: 1, tx: 0, ty: 400 };

/** A horizontal wall at map y = -300, i.e. screen y = 700. */
const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -400, max_x: 400, max_y: 0 },
  lines: [{ x1: 20, y1: -300, x2: 380, y2: -300, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

function renderInto(width: number, height: number): boolean {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d');
  expect(ctx, 'a 2D context is required for this test').not.toBeNull();
  const c = ctx as CanvasRenderingContext2D;
  c.fillStyle = PALETTE.bg;
  c.fillRect(0, 0, width, height);
  drawMapLayers(c, MAP, T, width, height, PALETTE, null);
  // Sample the row the wall sits on. Reading one row rather than the whole
  // canvas keeps the assertion about that line specifically.
  const { data } = c.getImageData(0, 699, width, 3);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p] > 128 && data[p + 1] < 128) return true;
  }
  return false;
}

describe('drawMapLayers', () => {
  it('draws a line the surface is tall enough to show', () => {
    expect(renderInto(400, 800)).toBe(true);
  });

  it('culls that same line on a surface too short to show it', () => {
    // Same map, same transform, smaller surface. This can only pass if the
    // height reached the cull rect through the parameter.
    expect(renderInto(400, 400)).toBe(false);
  });
});
