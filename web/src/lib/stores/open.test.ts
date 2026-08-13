import { describe, it, expect, vi, beforeEach } from 'vitest';
import { openWad } from './open';
import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

const { calls, pendingLoads } = vi.hoisted(() => ({
  calls: [] as string[],
  pendingLoads: [] as Array<(committed: boolean) => void>,
}));

vi.mock('./nav.svelte', () => ({
  nav: { reset: vi.fn(() => calls.push('nav.reset')) },
}));

vi.mock('./wad.svelte', () => ({
  wad: {
    load: vi.fn((file: File) => {
      calls.push(`wad.load(${file.name})`);
      return new Promise<boolean>((resolve) => pendingLoads.push(resolve));
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
    pendingLoads[0](true);
    await done;
  });

  it('resets navigation again once the load commits', async () => {
    // The pre-load reset cannot cover navigation performed *during* the load.
    // No UI can do that today — `Sidebar` and `BottomNav` disable everything
    // unless `wad.phase === 'loaded'` — so this pins the invariant rather than
    // a reachable bug (#123, whose original repro did not exist). It is what
    // stops a future change enabling navigation during loads from stranding
    // the user on a map name from the outgoing WAD.
    const done = openWad(new File(['x'], 'a.wad'));
    expect(nav.reset).toHaveBeenCalledTimes(1);
    pendingLoads[0](true);
    await done;
    expect(nav.reset).toHaveBeenCalledTimes(2);
  });

  it('keeps a superseded load from disturbing newer navigation', async () => {
    const first = openWad(new File(['x'], 'a.wad'));
    const second = openWad(new File(['x'], 'b.wad'));
    expect(calls).toEqual(['nav.reset', 'wad.load(a.wad)', 'nav.reset', 'wad.load(b.wad)']);

    // A superseded load resolves false and must add no reset, even though it
    // settles while a newer load owns the state.
    pendingLoads[0](false);
    await first;
    expect(nav.reset).toHaveBeenCalledTimes(2);

    pendingLoads[1](true);
    await second;
    expect(nav.reset).toHaveBeenCalledTimes(3);
  });

  it('does not reset when the load fails', async () => {
    const done = openWad(new File(['x'], 'bad.wad'));
    pendingLoads[0](false);
    await done;
    expect(nav.reset).toHaveBeenCalledTimes(1);
  });
});
