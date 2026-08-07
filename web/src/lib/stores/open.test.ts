import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openWad } from './open';
import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

const { calls, pendingLoads } = vi.hoisted(() => ({
  calls: [] as string[],
  pendingLoads: [] as Array<() => void>,
}));

vi.mock('./nav.svelte', () => ({
  nav: { reset: vi.fn(() => calls.push('nav.reset')) },
}));

vi.mock('./wad.svelte', () => ({
  wad: {
    load: vi.fn((file: File) => {
      calls.push(`wad.load(${file.name})`);
      return new Promise<void>((resolve) => pendingLoads.push(resolve));
    }),
  },
}));

describe('openWad', () => {
  beforeEach(() => {
    calls.length = 0;
    pendingLoads.length = 0;
    vi.clearAllMocks();
  });

  it('resets navigation before starting the load', async () => {
    const file = new File(['x'], 'a.wad');
    const done = openWad(file);
    expect(calls).toEqual(['nav.reset', 'wad.load(a.wad)']);
    expect(wad.load).toHaveBeenCalledWith(file);
    pendingLoads[0]();
    await done;
  });

  it('keeps a superseded load from disturbing newer navigation', async () => {
    const first = openWad(new File(['x'], 'a.wad'));
    const second = openWad(new File(['x'], 'b.wad'));
    expect(calls).toEqual(['nav.reset', 'wad.load(a.wad)', 'nav.reset', 'wad.load(b.wad)']);

    // The superseded load completing late must not reset navigation again.
    pendingLoads[0]();
    await first;
    expect(calls).toEqual(['nav.reset', 'wad.load(a.wad)', 'nav.reset', 'wad.load(b.wad)']);

    pendingLoads[1]();
    await second;
    expect(nav.reset).toHaveBeenCalledTimes(2);
  });
});
