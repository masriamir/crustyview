import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThemeStore } from './theme.svelte';

type ChangeListener = (e: { matches: boolean }) => void;

/** Install a controllable matchMedia stub; the returned setter fires change listeners. */
function stubMatchMedia(initialDark: boolean): (dark: boolean) => void {
  const listeners: ChangeListener[] = [];
  let dark = initialDark;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return dark;
    },
    media: query,
    addEventListener(_type: string, listener: ChangeListener) {
      listeners.push(listener);
    },
  }));
  return (next: boolean) => {
    dark = next;
    for (const listener of listeners) listener({ matches: next });
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeStore', () => {
  it('defaults to the system preference (light system)', () => {
    stubMatchMedia(false);
    const theme = new ThemeStore();
    expect(theme.preference).toBe('system');
    expect(theme.resolved).toBe('light');
  });

  it('defaults to the system preference (dark system)', () => {
    stubMatchMedia(true);
    expect(new ThemeStore().resolved).toBe('dark');
  });

  it('tracks system changes while unoverridden', () => {
    const setDark = stubMatchMedia(false);
    const theme = new ThemeStore();
    setDark(true);
    expect(theme.resolved).toBe('dark');
  });

  it('honors a stored override on construction', () => {
    stubMatchMedia(false);
    localStorage.setItem('crustyview-theme', 'dark');
    const theme = new ThemeStore();
    expect(theme.preference).toBe('dark');
    expect(theme.resolved).toBe('dark');
  });

  it('ignores a corrupt stored value', () => {
    stubMatchMedia(false);
    localStorage.setItem('crustyview-theme', 'blorp');
    expect(new ThemeStore().preference).toBe('system');
  });

  it('toggle overrides the system preference and persists', () => {
    stubMatchMedia(true);
    const theme = new ThemeStore();
    theme.toggle();
    expect(theme.resolved).toBe('light');
    expect(localStorage.getItem('crustyview-theme')).toBe('light');
  });

  it('toggle flips an explicit override and persists', () => {
    stubMatchMedia(false);
    localStorage.setItem('crustyview-theme', 'dark');
    const theme = new ThemeStore();
    theme.toggle();
    expect(theme.resolved).toBe('light');
    expect(localStorage.getItem('crustyview-theme')).toBe('light');
  });
});
