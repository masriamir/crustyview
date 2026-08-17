/**
 * The debounce/baseline machine behind the grid live region, extracted from
 * Map2d.svelte's draw() (#175). Each test pins a semantic that shipped as a
 * bug fix: #127 (a gesture must delay, not cancel), #131 (a map switch is not
 * a grid transition), #76 (announce where the zoom landed, not where it was).
 * The two announcement browser tests remain the integration proof; these are
 * the fast tier for the same machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRID_ANNOUNCE_DELAY_MS, createGridAnnouncer } from './gridAnnouncer';

describe('createGridAnnouncer', () => {
  let announced: string[];
  let announcer: ReturnType<typeof createGridAnnouncer>;

  beforeEach(() => {
    vi.useFakeTimers();
    announced = [];
    announcer = createGridAnnouncer((text) => announced.push(text));
    announcer.observeMap('MAP01');
    announced.length = 0; // the first observeMap clears the region; not under test here
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces a crossing after the debounce, with the latest text', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'Grid 32 (too small)');
    expect(announced).toEqual([]);
    // #76: a non-crossing draw refreshes the pending text to where the zoom landed.
    announcer.observe(true, false, 'Grid 32 (still too small)');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual(['Grid 32 (still too small)']);
  });

  it('never announces without a crossing', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, true, 'Grid 32');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS * 3);
    expect(announced).toEqual([]);
  });

  it('a non-crossing refresh does not extend the debounce window (#127)', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'crossing');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS - 100);
    announcer.observe(true, false, 'refreshed');
    vi.advanceTimersByTime(100);
    expect(announced).toEqual(['refreshed']);
  });

  it('a fresh crossing restarts the window', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'off');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS - 100);
    announcer.observe(true, true, 'back on');
    vi.advanceTimersByTime(100);
    expect(announced).toEqual([]);
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS - 100);
    expect(announced).toEqual(['back on']);
  });

  it('a map switch cancels the pending announcement and clears the region (#131)', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'crossing');
    announcer.observeMap('MAP02');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS * 2);
    expect(announced).toEqual(['']);
    // The new map has no baseline: its first observation establishes silently.
    announcer.observe(true, true, 'Grid 32');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual(['']);
  });

  it('re-observing the same map is not a switch', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observeMap('MAP01');
    announcer.observe(true, false, 'crossing');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual(['crossing']);
  });

  it('hiding stands a pending transition down; re-showing re-baselines silently', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'crossing');
    announcer.observe(false, false, '');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS * 2);
    expect(announced).toEqual([]);
    announcer.observe(true, false, 'Grid 32');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual([]);
  });

  it('announceNow with a baseline preempts a pending transition and moves the baseline', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'debounced');
    announcer.announceNow('Grid 64', false);
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS * 2);
    expect(announced).toEqual(['Grid 64']);
    // Baseline moved to false: observing false again is not a crossing.
    announcer.observe(true, false, 'not a crossing');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual(['Grid 64']);
  });

  it('announceNow without a baseline leaves a pending transition alone', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'debounced');
    announcer.announceNow('Grid 64');
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    expect(announced).toEqual(['Grid 64', 'debounced']);
  });

  it('dispose cancels without announcing', () => {
    announcer.observe(true, true, 'Grid 32');
    announcer.observe(true, false, 'crossing');
    announcer.dispose();
    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS * 2);
    expect(announced).toEqual([]);
  });
});
