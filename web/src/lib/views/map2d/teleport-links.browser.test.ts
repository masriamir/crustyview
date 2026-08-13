import { describe, it, expect, vi } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #66: the links are drawn inside the same overlay as the teleport source
 * lines, so the E2E chip spec cannot distinguish them. Comparing two renders
 * of the same map — one whose payload carries a link, one whose does not —
 * isolates `drawTeleportLinks` and nothing else.
 */
const BASE: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: 512, max_y: 512 },
  lines: [
    { x1: 0, y1: 0, x2: 512, y2: 0, kind: 'one_sided' },
    { x1: 512, y1: 0, x2: 512, y2: 512, kind: 'one_sided' },
    { x1: 512, y1: 512, x2: 0, y2: 512, kind: 'two_sided' },
    { x1: 0, y1: 512, x2: 0, y2: 0, kind: 'secret' },
  ],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

const withLink: Map2dPayload = { ...BASE, links: [{ from: [64, 64], to: [448, 448] }] };

let payload: Map2dPayload = BASE;

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    map2d: () => payload,
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');

installMapSizing();

/** The canvas's pixels, once it has painted. */
async function snapshot(): Promise<string> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
  expect(await painted(canvas)).toBe(true);
  return canvas.toDataURL();
}

describe('teleport links', () => {
  it('draw only when the payload carries them and the overlay is on', async () => {
    mapPrefs.showTeleportLines = true;

    payload = BASE;
    const without = await snapshot();
    payload = withLink;
    const withIt = await snapshot();
    expect(withIt, 'a link in the payload must change what is drawn').not.toBe(without);

    // And they belong to the teleport overlay, not to the base map.
    mapPrefs.showTeleportLines = false;
    payload = BASE;
    const offWithout = await snapshot();
    payload = withLink;
    const offWith = await snapshot();
    expect(offWith, 'with the overlay off, a link must change nothing').toBe(offWithout);
  });
});
