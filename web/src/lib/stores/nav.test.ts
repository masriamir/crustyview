import { describe, it, expect } from 'vitest';
import { NavStore } from './nav.svelte';

describe('NavStore', () => {
  it('starts at overview with no map selected, in 2d', () => {
    const nav = new NavStore();
    expect(nav.section).toBe('overview');
    expect(nav.selectedMap).toBeNull();
    expect(nav.mapMode).toBe('2d');
  });

  it('selectMap jumps to the maps section with that map active', () => {
    const nav = new NavStore();
    nav.selectMap('MAP01');
    expect(nav.section).toBe('maps');
    expect(nav.selectedMap).toBe('MAP01');
  });

  it('goto preserves the map selection so returning to Maps restores it', () => {
    const nav = new NavStore();
    nav.selectMap('MAP01');
    nav.goto('lumps');
    expect(nav.section).toBe('lumps');
    expect(nav.selectedMap).toBe('MAP01');
    nav.goto('maps');
    expect(nav.selectedMap).toBe('MAP01');
  });

  it('showMapList stays in maps but clears the selection', () => {
    const nav = new NavStore();
    nav.selectMap('E1M1');
    nav.showMapList();
    expect(nav.section).toBe('maps');
    expect(nav.selectedMap).toBeNull();
  });

  it('setMapMode switches the map mode', () => {
    const nav = new NavStore();
    nav.setMapMode('3d');
    expect(nav.mapMode).toBe('3d');
  });

  it('reset returns to the initial state', () => {
    const nav = new NavStore();
    nav.selectMap('MAP07');
    nav.setMapMode('3d');
    nav.reset();
    expect(nav.section).toBe('overview');
    expect(nav.selectedMap).toBeNull();
    expect(nav.mapMode).toBe('2d');
  });
});
