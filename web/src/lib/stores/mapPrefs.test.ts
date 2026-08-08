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
});
