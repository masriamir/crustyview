import { describe, it, expect, vi } from 'vitest';

/**
 * #125: the content behind `LoadingOverlay` must stop being keyboard-reachable
 * once the overlay is opaque — and must NOT before then. The second half is the
 * point: the overlay is deliberately `visibility: hidden` for its first 250ms
 * (#57), so inertness that starts with the load would leave the app dead but
 * visible on every load, which is the bug that delay exists to prevent.
 */
vi.mock('../stores/wad.svelte', () => ({
  wad: {
    phase: 'loading',
    // Non-null so Shell's `showContent` is true: the outgoing WAD's view stays
    // mounted while the replacement loads, which is what the overlay covers.
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    mapNames: ['MAP01'],
    fileName: 'outgoing.wad',
    loadingFileName: 'incoming.wad',
    error: null,
    mapStats: () => null,
  },
}));

// Unlike the map2d browser tests, mounting the whole `Shell` also mounts
// `StatusBar`, which calls the real wasm module's `version()` unconditionally
// (not gated on `wad.phase`). That module is only usable after `main.ts`'s
// `init()`, which this test never runs, so it must be mocked the same way
// `wad.test.ts` mocks it for the unit tier.
vi.mock('../../wasm/crustyview_web.js', () => ({ version: () => '0.0.0-test' }));

const { render } = await import('vitest-browser-svelte');
const Shell = (await import('./Shell.svelte')).default;

// No sizing helper here, unlike the map2d tests: `Shell` is `height: 100dvh`,
// so it sizes itself from the viewport, and nothing under test draws to canvas.

describe('main content while a WAD loads', () => {
  it('goes inert only once the overlay has actually revealed', async () => {
    const started = performance.now();
    const screen = await render(Shell);
    const main = screen.container.querySelector('main.main');
    expect(main, 'Shell should render a main element').not.toBeNull();

    // Before the reveal the user can still see this content, so it must remain
    // usable. This assertion is what fails if the wiring is ever "simplified"
    // to inert-while-loading.
    expect(
      (main as HTMLElement).hasAttribute('inert'),
      'main must not be inert while the overlay is still invisible',
    ).toBe(false);

    await expect
      .poll(() => (main as HTMLElement).hasAttribute('inert'), { timeout: 3000 })
      .toBe(true);

    // The 250ms delay is the requirement, not an implementation detail. This is
    // the only assertion that catches a reveal firing *too early* — one that is
    // still deferred past mount, so the check above passes, but no longer waits
    // out the delay. Verified: dropping the delay to 0ms leaves both assertions
    // above green and fails here at ~126ms.
    expect(performance.now() - started).toBeGreaterThan(200);
  });
});
