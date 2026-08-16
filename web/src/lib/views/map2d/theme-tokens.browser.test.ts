import { describe, it, expect, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { drawMapLayers, resolvePalette } from './render';
import type { Transform } from './transform';

/**
 * The browser tier can see the themed palette (#158).
 *
 * Until `browser-test-setup.ts` began loading `app.css`, no `--map2d-*` token
 * was defined in any spec's page, so `resolvePalette` fell through to its
 * classic fallbacks for BOTH styles. Every browser spec was therefore asserting
 * the classic palette regardless of the style it selected, and — the part that
 * matters — deleting a token from `app.css` would have broken the app while the
 * suite stayed green, because the fallback silently covered for it.
 *
 * This file is the check that the tier is no longer blind to that. It is
 * deliberately written against the public API only: `resolvePalette(el,
 * 'classic')` returns the fallback palette, so the themed values can be
 * compared against it without exporting `CLASSIC` just for a test.
 *
 * **What makes it a real check rather than a restatement.** The load-bearing
 * assertion is that the themed color DIFFERS from the classic one. Remove
 * `--map2d-wall` from `app.css` and `resolvePalette` returns `CLASSIC.wall`,
 * the two become equal, and this goes red — which is exactly the regression the
 * old tier could not see.
 *
 * Each of those claims was checked by breaking it on purpose rather than
 * reasoned about:
 *
 * | broken on purpose | result |
 * |---|---|
 * | `--map2d-wall` deleted from `app.css` | 3 red, `expected '#ff3b30' not to be '#ff3b30'` |
 * | `--map2d-wall: not-a-color` | 2 red, `the themed wall token should hold a color` |
 * | `setupFiles` wiring removed | 3 red — the tier goes blind again |
 *
 * It asserts a *difference* rather than the literal `#bf3a1e` on purpose. The
 * specific hue is a design decision that may be retuned; that the themed style
 * is distinguishable from classic at all is the contract. For the same reason
 * nothing here parses hex — see `swatch` and `parsedColor`.
 */

/** Identity scale, no offset: map (x, y) draws at screen (x, -y). */
const T: Transform = { scale: 1, tx: 0, ty: 400 };

/** One horizontal wall at map y = -300, i.e. screen y = 700. */
const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -400, max_x: 400, max_y: 0 },
  lines: [{ x1: 20, y1: -300, x2: 380, y2: -300, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

function scratch(): CanvasRenderingContext2D {
  const el = document.createElement('canvas');
  el.width = 1;
  el.height = 1;
  return el.getContext('2d') as CanvasRenderingContext2D;
}

/**
 * `color` as the canvas itself interprets it, or `null` if the canvas rejects
 * it.
 *
 * Assigning an unparseable value to `fillStyle` is a no-op, leaving whatever was
 * there before — so two attempts from different starting points agree only when
 * the value actually parsed. That is what distinguishes "the token holds a color"
 * from "the token holds nonsense", without this test having an opinion about
 * which CSS syntax the design tokens are written in.
 */
function parsedColor(color: string): string | null {
  const c = scratch();
  c.fillStyle = '#000000';
  c.fillStyle = color;
  const first = c.fillStyle;
  c.fillStyle = '#ffffff';
  c.fillStyle = color;
  return c.fillStyle === first ? first : null;
}

/**
 * `color`'s RGB as the canvas paints it.
 *
 * Painting rather than parsing is deliberate: the tokens are `#rrggbb` today,
 * but `rgb()`, `oklch()` or a named color are all equally valid CSS, and a test
 * that parsed hex by hand would fail on a purely cosmetic retune while the app
 * stayed correct. Letting the canvas do the conversion also compares against the
 * exact bytes the real draw would produce.
 */
function swatch(color: string): [number, number, number] {
  const c = scratch();
  c.fillStyle = color;
  c.fillRect(0, 0, 1, 1);
  const { data } = c.getImageData(0, 0, 1, 1);
  return [data[0], data[1], data[2]];
}

/**
 * A canvas attached to the document, which `getComputedStyle` requires in order
 * to inherit the custom properties defined on `:root`.
 */
function attachedCanvas(width: number, height: number): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

describe('themed palette in the browser tier', () => {
  it('resolves --map2d-* tokens instead of falling back to classic', () => {
    const el = attachedCanvas(10, 10);
    const classic = resolvePalette(el, 'classic');
    const themed = resolvePalette(el, 'theme');

    // If `app.css` were not loaded — or the token were removed from it — every
    // one of these would equal its classic counterpart.
    expect(themed.wall).not.toBe(classic.wall);
    expect(themed.bg).not.toBe(classic.bg);
    expect(themed.grid).not.toBe(classic.grid);
    expect(themed.player).not.toBe(classic.player);
    // Not a syntax assertion — `parsedColor` asks the canvas whether the value
    // is a color at all, so a token holding nonsense fails here while a retune
    // to `rgb()` or `oklch()` passes.
    expect(parsedColor(themed.wall), 'the themed wall token should hold a color').not.toBeNull();
  });

  it('puts the themed wall color on the canvas, not the classic one', () => {
    const width = 400;
    const height = 800;
    const el = attachedCanvas(width, height);
    const ctx = el.getContext('2d');
    expect(ctx, 'a 2D context is required for this test').not.toBeNull();
    const c = ctx as CanvasRenderingContext2D;

    const classic = resolvePalette(el, 'classic');
    const themed = resolvePalette(el, 'theme');
    c.fillStyle = themed.bg;
    c.fillRect(0, 0, width, height);
    drawMapLayers(c, MAP, T, width, height, themed, null);

    // Sample the band the wall sits on rather than the whole canvas, so the
    // assertion is about that line and not about anything else that painted.
    const { data } = c.getImageData(0, 698, width, 5);
    const want = swatch(themed.wall);
    const classicRgb = swatch(classic.wall);
    let themedPixels = 0;
    let classicPixels = 0;
    for (let p = 0; p < data.length; p += 4) {
      const px: [number, number, number] = [data[p], data[p + 1], data[p + 2]];
      if (px.every((v, i) => v === want[i])) themedPixels++;
      if (px.every((v, i) => v === classicRgb[i])) classicPixels++;
    }
    expect(themedPixels, 'the wall should be drawn in the themed color').toBeGreaterThan(0);
    expect(classicPixels, 'no pixel should carry the classic fallback color').toBe(0);
  });

  it('follows the data-theme attribute, so dark is a different palette again', () => {
    const el = attachedCanvas(10, 10);
    const light = resolvePalette(el, 'theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    const dark = resolvePalette(el, 'theme');

    // `app.css` gates dark on this attribute and defines no
    // `prefers-color-scheme` query, so the tier is deterministic regardless of
    // the runner's appearance settings — this pins that.
    expect(dark.bg).not.toBe(light.bg);
    expect(dark.wall).not.toBe(light.wall);
  });
});
