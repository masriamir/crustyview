import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MapPrefsStore } from './mapPrefs.svelte';
import { CATEGORIES } from '../views/map2d/things';

const KEY = 'crustyview-map-prefs';

describe('MapPrefsStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults: things on, grid off, theme style', () => {
    const p = new MapPrefsStore();
    expect(p.showThings).toBe(true);
    expect(p.showGrid).toBe(false);
    expect(p.style).toBe('theme');
  });

  it('defaults: GL MSAA off, GL feather on', () => {
    const p = new MapPrefsStore();
    expect(p.glMsaa).toBe(false);
    expect(p.glFeather).toBe(true);
  });

  it('GL prefs toggle, persist, and restore', () => {
    const p = new MapPrefsStore();
    p.toggleGlMsaa();
    p.toggleGlFeather();
    expect(p.glMsaa).toBe(true);
    expect(p.glFeather).toBe(false);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      glMsaa: boolean;
      glFeather: boolean;
    };
    expect(stored.glMsaa).toBe(true);
    expect(stored.glFeather).toBe(false);
    const q = new MapPrefsStore();
    expect(q.glMsaa).toBe(true);
    expect(q.glFeather).toBe(false);
  });

  it('non-boolean stored GL prefs are ignored', () => {
    localStorage.setItem(KEY, JSON.stringify({ glMsaa: 'nope', glFeather: 1 }));
    const p = new MapPrefsStore();
    expect(p.glMsaa).toBe(false);
    expect(p.glFeather).toBe(true);
  });

  it('toggles persist as JSON', () => {
    const p = new MapPrefsStore();
    p.toggleGrid();
    p.toggleStyle();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({
      showThings: true,
      showGrid: true,
      style: 'classic',
      hiddenThingCategories: [],
      showTeleportLines: true,
      showSecretSectors: false,
      showDamagingSectors: false,
      alwaysShowPlayerStart: true,
      gridSize: 32,
      showTeleportArcs: true,
      teleportArcCap: 100,
      glMsaa: false,
      glFeather: true,
    });
    const q = new MapPrefsStore();
    expect(q.showGrid).toBe(true);
    expect(q.style).toBe('classic');
  });

  it('garbage in storage falls back to defaults', () => {
    localStorage.setItem(KEY, 'not json');
    const p = new MapPrefsStore();
    expect(p.showThings).toBe(true);
    expect(p.style).toBe('theme');
  });

  it('falls back to defaults when storage reads are blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const p = new MapPrefsStore();
    expect(p.showThings).toBe(true);
    expect(p.showGrid).toBe(false);
    expect(p.style).toBe('theme');
  });

  it('toggle still applies for the session when storage writes are blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const p = new MapPrefsStore();
    expect(() => p.toggleGrid()).not.toThrow();
    expect(p.showGrid).toBe(true);
    expect(() => p.toggleCategory('monsters')).not.toThrow();
    expect(p.isCategoryShown('monsters')).toBe(false);
  });

  it('category visibility defaults to all shown', () => {
    const p = new MapPrefsStore();
    for (const { id } of CATEGORIES) expect(p.isCategoryShown(id)).toBe(true);
  });

  it('toggleCategory hides, persists the hidden list, and restores', () => {
    const p = new MapPrefsStore();
    p.toggleCategory('monsters');
    p.toggleCategory('keys');
    expect(p.isCategoryShown('monsters')).toBe(false);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      hiddenThingCategories: string[];
    };
    expect([...stored.hiddenThingCategories].sort()).toEqual(['keys', 'monsters']);
    const q = new MapPrefsStore();
    expect(q.isCategoryShown('monsters')).toBe(false);
    expect(q.isCategoryShown('keys')).toBe(false);
    expect(q.isCategoryShown('weapons')).toBe(true);
  });

  it('restore drops unknown category ids and ignores non-array values', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ hiddenThingCategories: ['monsters', 'gibberish', 7, 'toString'] }),
    );
    const p = new MapPrefsStore();
    expect(p.isCategoryShown('monsters')).toBe(false);
    // Prototype-chain keys must not graft own properties onto the record.
    expect(Object.keys(p.showCategories)).toEqual(CATEGORIES.map((c) => c.id));
    localStorage.setItem(KEY, JSON.stringify({ hiddenThingCategories: 'monsters' }));
    const q = new MapPrefsStore();
    expect(q.isCategoryShown('monsters')).toBe(true);
  });

  it('teleport lines default on; toggle flips, persists, and restores', () => {
    const p = new MapPrefsStore();
    expect(p.showTeleportLines).toBe(true);
    p.toggleTeleportLines();
    expect(p.showTeleportLines).toBe(false);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as {
      showTeleportLines: boolean;
    };
    expect(stored.showTeleportLines).toBe(false);
    const q = new MapPrefsStore();
    expect(q.showTeleportLines).toBe(false);
  });

  it('non-boolean stored showTeleportLines is ignored', () => {
    localStorage.setItem(KEY, JSON.stringify({ showTeleportLines: 'nope' }));
    const p = new MapPrefsStore();
    expect(p.showTeleportLines).toBe(true);
  });

  it('storage predating the arc/line split inherits the old flag for the arcs', () => {
    // #154 split one preference into two. Before it, `showTeleportLines: false`
    // meant "no source lines AND no arcs", so restoring the new key from its
    // default would hand a returning user arcs they had switched off.
    localStorage.setItem(KEY, JSON.stringify({ showTeleportLines: false }));
    const p = new MapPrefsStore();
    expect(p.showTeleportLines).toBe(false);
    expect(p.showTeleportArcs).toBe(false);
  });

  it('a stored showTeleportArcs wins over the pre-split flag', () => {
    // The inheritance only fills a gap. Once the new key exists it is an
    // explicit choice, and the old flag must not override it in either
    // direction.
    localStorage.setItem(KEY, JSON.stringify({ showTeleportLines: false, showTeleportArcs: true }));
    expect(new MapPrefsStore().showTeleportArcs).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ showTeleportLines: true, showTeleportArcs: false }));
    expect(new MapPrefsStore().showTeleportArcs).toBe(false);
  });

  it('sector overlays default off; toggles flip, persist, and restore', () => {
    const p = new MapPrefsStore();
    expect(p.showSecretSectors).toBe(false);
    expect(p.showDamagingSectors).toBe(false);
    p.toggleSecretSectors();
    p.toggleDamagingSectors();
    expect(p.showSecretSectors).toBe(true);
    expect(p.showDamagingSectors).toBe(true);
    const q = new MapPrefsStore();
    expect(q.showSecretSectors).toBe(true);
    expect(q.showDamagingSectors).toBe(true);
  });

  it('non-boolean stored sector overlay prefs are ignored', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ showSecretSectors: 1, showDamagingSectors: 'yes' }),
    );
    const p = new MapPrefsStore();
    expect(p.showSecretSectors).toBe(false);
    expect(p.showDamagingSectors).toBe(false);
  });

  it('player start defaults to always shown; toggle flips, persists, and restores', () => {
    const p = new MapPrefsStore();
    expect(p.alwaysShowPlayerStart).toBe(true);
    p.toggleAlwaysShowPlayerStart();
    expect(p.alwaysShowPlayerStart).toBe(false);
    const q = new MapPrefsStore();
    expect(q.alwaysShowPlayerStart).toBe(false);
  });

  it('non-boolean stored alwaysShowPlayerStart is ignored', () => {
    localStorage.setItem(KEY, JSON.stringify({ alwaysShowPlayerStart: 'nope' }));
    const p = new MapPrefsStore();
    expect(p.alwaysShowPlayerStart).toBe(true);
  });

  it('showPlayerStart is false only when things and always-show are both off', () => {
    const p = new MapPrefsStore();
    expect(p.showPlayerStart).toBe(true); // things on, always-show on
    p.toggleThings();
    expect(p.showPlayerStart).toBe(true); // things off, always-show on
    p.toggleAlwaysShowPlayerStart();
    expect(p.showPlayerStart).toBe(false); // things off, always-show off
    p.toggleThings();
    expect(p.showPlayerStart).toBe(true); // things on, always-show off
  });

  it('grid size defaults to 32; setGridSize persists and restores', () => {
    const p = new MapPrefsStore();
    expect(p.gridSize).toBe(32);
    p.setGridSize(64);
    expect(p.gridSize).toBe(64);
    const q = new MapPrefsStore();
    expect(q.gridSize).toBe(64);
  });

  it('non-ladder stored gridSize falls back to 32', () => {
    localStorage.setItem(KEY, JSON.stringify({ gridSize: 33 }));
    expect(new MapPrefsStore().gridSize).toBe(32);
    localStorage.setItem(KEY, JSON.stringify({ gridSize: 'big' }));
    expect(new MapPrefsStore().gridSize).toBe(32);
  });
});
