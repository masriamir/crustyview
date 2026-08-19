import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

/**
 * #183: the current-nav item must clear SC 1.4.3 (4.5:1, normal-size text) in
 * both themes — and ADR-0007's second enforcement tier is exactly this file:
 * token-contrast assertions in the browser tier, landing with #183.
 *
 * **The defect this exists to prevent.** The selected sidebar item drew
 * `var(--accent)` on a background mixed *from the same accent*
 * (`color-mix(in srgb, var(--accent) 14%, transparent)`). The tint lifts the
 * ground toward the ink, so the pairing ate its own contrast: 4.06:1 in the
 * light theme, against a 4.5:1 minimum. The #51 baseline audit found it as the
 * app's only strict AA failure.
 *
 * **Why this measures the DOM instead of recomputing from tokens.** A test that
 * read `--accent` and `--bg` out of `app.css` and re-derived the mix would be a
 * restatement of the CSS: it would stay green if someone raised the tint in
 * `Sidebar.svelte`, which is one of the two ways to reintroduce the bug. So
 * `contrastOf` mounts the real component, reads the computed `color`, and
 * composites every background layer from the element up to the page canvas —
 * the same stack a browser paints and a user sees. Both the token and the
 * component CSS are therefore live inputs.
 *
 * **Why the canvas does the color math.** Following `theme-tokens.browser.test.ts`:
 * nothing here parses a color string. Computed styles come back as `rgb()` /
 * `rgba()` today but `color(srgb …)` is equally valid CSS, and a hand-written
 * parser would fail on a purely cosmetic retune while the app stayed correct.
 * Painting each layer in order lets the canvas perform the alpha compositing and
 * hands back the exact bytes the real draw produces.
 *
 * Each claim below was checked by breaking it on purpose rather than reasoned
 * about:
 *
 * | broken on purpose | result |
 * |---|---|
 * | `--nav-current` reverted to `var(--accent)` in the light block | 2 red at 4.03:1 — the original #183 defect |
 * | selected-item tint raised 14% → 30% with the fix in place | 2 red at 4.06:1 — catches the second route back to the bug, which no token-only test would see |
 * | `backdropOf` stubbed to return the body background (ignoring the tint) | the "sees the tint" guard goes red; without it the suite passes at 4.97:1 while measuring the wrong pixels |
 *
 * Note the audit's per-site figures (4.05:1 Overview / 4.43:1 map entry) came
 * from axe's own backdrop resolution. Measured here, both sidebar sites are
 * 4.03:1 — they composite over the same `body` surface, since nothing between
 * them and it paints a background. The finding is unchanged; only the second
 * decimal place moved, and in the direction that made it slightly worse.
 */

vi.mock('../stores/wad.svelte', async () => await import('./__fixtures__/wad-mock.svelte'));

const { render } = await import('vitest-browser-svelte');
const Sidebar = (await import('./Sidebar.svelte')).default;
const BottomNav = (await import('./BottomNav.svelte')).default;
const { wad, resetWadMock } = await import('./__fixtures__/wad-mock.svelte');
const { nav } = await import('../stores/nav.svelte');

/** SC 1.4.3 minimum for normal-size text. The nav labels are 13.3px and 14.4px,
 * so the 3:1 large-text allowance does not apply to either site. */
const AA_NORMAL_TEXT = 4.5;

type Rgb = [number, number, number];

function scratch(): CanvasRenderingContext2D {
  const el = document.createElement('canvas');
  el.width = 1;
  el.height = 1;
  const ctx = el.getContext('2d');
  // Asserted rather than bare-cast, matching the rest of the browser tier: a
  // null context here would otherwise surface as a null-deref inside a color
  // helper, several frames from the thing that actually went wrong.
  expect(ctx, 'a 2D context is required for this test').not.toBeNull();
  return ctx as CanvasRenderingContext2D;
}

/** `color` painted over `base`, as the canvas composites it. Translucent values
 * blend; opaque ones replace; `rgba(0, 0, 0, 0)` is a no-op. */
function paintOver(base: Rgb, color: string): Rgb {
  const c = scratch();
  c.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
  c.fillRect(0, 0, 1, 1);
  c.fillStyle = color;
  c.fillRect(0, 0, 1, 1);
  const { data } = c.getImageData(0, 0, 1, 1);
  return [data[0], data[1], data[2]];
}

/**
 * What is actually behind `el`'s text: its own background plus every ancestor's,
 * composited outermost-first onto the page canvas.
 *
 * Walking the whole chain rather than naming a surface is what keeps this
 * honest about *both* nav sites — the sidebar sits on the body's `--bg` with a
 * translucent tint of its own, the bottom nav sits on an opaque `--bg-raised`
 * with no tint, and neither fact is written down here.
 */
function backdropOf(el: HTMLElement): Rgb {
  const layers: string[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    layers.push(getComputedStyle(n).backgroundColor);
  }
  // White is the page canvas showing through, which is what a browser paints
  // when nothing in the chain is opaque.
  let out: Rgb = [255, 255, 255];
  for (const layer of layers.reverse()) out = paintOver(out, layer);
  return out;
}

/** WCAG 2.x relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between `el`'s text and everything painted behind it. */
function contrastOf(el: HTMLElement): number {
  const backdrop = backdropOf(el);
  const ink = paintOver(backdrop, getComputedStyle(el).color);
  const [hi, lo] = [luminance(ink), luminance(backdrop)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

function current(container: ParentNode): HTMLElement {
  const el = container.querySelector<HTMLElement>('button[aria-current="page"]');
  expect(el, 'the component should render exactly one current nav item').not.toBeNull();
  return el as HTMLElement;
}

/** Run `probe` in the light theme and again in the dark one. `app.css` gates
 * dark on this attribute and defines no `prefers-color-scheme` query, so the
 * tier is deterministic regardless of the runner's appearance settings. */
function inBothThemes(probe: () => number): { light: number; dark: number } {
  const light = probe();
  document.documentElement.setAttribute('data-theme', 'dark');
  const dark = probe();
  document.documentElement.removeAttribute('data-theme');
  return { light, dark };
}

beforeEach(() => {
  resetWadMock();
  // The fixture starts mid-load, which disables every nav button and hides the
  // map entries. This file is about the *selected* state, so it needs a
  // committed WAD.
  wad.phase = 'loaded';
  nav.reset();
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  nav.reset();
});

describe('nav current-item contrast (SC 1.4.3)', () => {
  it('clears 4.5:1 on the selected sidebar section in both themes', async () => {
    const screen = await render(Sidebar);
    const { light, dark } = inBothThemes(() => contrastOf(current(screen.container)));

    // 4.06:1 before #183 — the audit's only strict AA failure.
    expect(light, `light theme measured ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(dark, `dark theme measured ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('clears 4.5:1 on a selected map entry in both themes', async () => {
    const screen = await render(Sidebar);
    // Map entries are smaller (0.9rem) and nested one level deeper, so the
    // audit measured them separately from the sections above. `flushSync`
    // settles the store mutation into the DOM before anything is read.
    nav.selectMap(wad.mapNames[0]);
    flushSync();
    expect(current(screen.container).textContent?.trim()).toBe(wad.mapNames[0]);

    const { light, dark } = inBothThemes(() => contrastOf(current(screen.container)));
    expect(light, `light theme measured ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(dark, `dark theme measured ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('clears 4.5:1 on the bottom nav current item in both themes', async () => {
    const screen = await render(BottomNav);
    const { light, dark } = inBothThemes(() => contrastOf(current(screen.container)));

    expect(light, `light theme measured ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
    expect(dark, `dark theme measured ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_NORMAL_TEXT,
    );
  });

  it('sees the selected item tint, not the bare surface behind it', async () => {
    const screen = await render(Sidebar);
    const el = current(screen.container);

    // Without this, a `backdropOf` that skipped the element's own translucent
    // background would report the untinted body surface — which measures
    // 4.97:1 with the *original* accent and would have passed the assertions
    // above while observing the wrong pixels entirely.
    expect(backdropOf(el)).not.toStrictEqual(backdropOf(document.body));
  });
});
