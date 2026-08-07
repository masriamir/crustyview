import { describe, it, expect, beforeEach } from 'vitest';
import { MapPrefsStore } from './mapPrefs.svelte';

const KEY = 'crustyview-map-prefs';

describe('MapPrefsStore', () => {
  beforeEach(() => localStorage.clear());

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
});
