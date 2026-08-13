import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

/**
 * #125: the content behind `LoadingOverlay` must stop being keyboard-reachable
 * once the overlay is opaque — and must NOT before then. The second half is the
 * point: the overlay is deliberately `visibility: hidden` for its first 250ms
 * (#57), so inertness that starts with the load would leave the app dead but
 * visible on every load, which is the bug that delay exists to prevent.
 *
 * The mock below is rune-backed (`__fixtures__/wad-mock.svelte.ts`) rather
 * than a plain object literal, because the second test needs to mutate
 * `wad.phase` mid-test and have `Shell`'s `$derived`s actually re-run — a
 * plain object handed to `vi.mock`'s inline factory cannot do that; runes
 * are unavailable in a bare `.ts` module.
 */
vi.mock('../stores/wad.svelte', async () => await import('./__fixtures__/wad-mock.svelte'));

// Unlike the map2d browser tests, mounting the whole `Shell` also mounts
// `StatusBar`, which calls the real wasm module's `version()` unconditionally
// (not gated on `wad.phase`). That module is only usable after `main.ts`'s
// `init()`, which this test never runs, so it must be mocked the same way
// `wad.test.ts` mocks it for the unit tier.
vi.mock('../../wasm/crustyview_web.js', () => ({ version: () => '0.0.0-test' }));

const { render } = await import('vitest-browser-svelte');
const Shell = (await import('./Shell.svelte')).default;
const { wad, resetWadMock } = await import('./__fixtures__/wad-mock.svelte');

// No sizing helper here, unlike the map2d tests: `Shell` is `height: 100dvh`,
// so it sizes itself from the viewport, and nothing under test draws to canvas.

// `wad` is a module-level singleton shared by every test in this file (the
// second test mutates it mid-run), so restore its starting values before
// each test rather than relying on test order.
beforeEach(() => {
  resetWadMock();
});

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

  it('clears inertness when the first overlay unmounts, so a second load does not start already-inert', async () => {
    const screen = await render(Shell);
    const main = screen.container.querySelector('main.main');
    expect(main, 'Shell should render a main element').not.toBeNull();

    await expect
      .poll(() => (main as HTMLElement).hasAttribute('inert'), { timeout: 3000 })
      .toBe(true);

    // First load commits. `showOverlay` goes false, `LoadingOverlay` unmounts,
    // and its `onDestroy` must clear `overlayRevealed` — that is the only thing
    // standing between this and the next assertion passing for the wrong reason.
    wad.phase = 'loaded';
    await expect.poll(() => (main as HTMLElement).hasAttribute('inert')).toBe(false);

    // Second load starts. `flushSync` forces `Shell`'s `$derived`s and the
    // resulting `inert` attribute to settle synchronously, so this checks the
    // state at the instant the load begins — before the new overlay has had
    // any chance to reveal. If `onDestroy` did not reset `overlayRevealed`,
    // `showOverlay && overlayRevealed` is already `true && true` here, and
    // `main` goes dead while the new overlay is still `visibility: hidden`
    // (#57) — on every load after the first, not just the second.
    wad.phase = 'loading';
    flushSync();
    expect(
      (main as HTMLElement).hasAttribute('inert'),
      'main must not be inert immediately at the start of a second load',
    ).toBe(false);
  });
});
