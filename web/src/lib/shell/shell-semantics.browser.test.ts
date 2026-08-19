import { describe, it, expect, vi, beforeEach } from 'vitest';
import { page } from '@vitest/browser/context';

/**
 * #188: the shell's semantics batch, plus the one invariant that batch decided
 * NOT to change.
 *
 * **Why these live in the browser tier rather than the fast one.** The unit tier
 * renders no components at all — it is pure modules and stores under `happy-dom`,
 * and `vitest-browser-svelte` is browser-mode only. More to the point, the
 * landmark test below turns on real CSS media queries, which `happy-dom` does
 * not evaluate. `startupFailure.test.ts` covers the fifth item of #188 in the
 * fast tier precisely because it was extracted out of `main.ts` into plain DOM
 * code with no component to mount.
 *
 * **The landmark test is a pinning test, not a bug reproduction.** #188 proposed
 * renaming one of the two `aria-label="Sections"` navs. That was declined: the
 * two are exact complements — `.sidebar` is `display: none` at or below 48rem,
 * `.bottom-nav` above it — and `display: none` removes a subtree from the
 * accessibility tree, so no viewport ever exposes both. The #51 audit
 * corroborates it: axe ran over 13 states with best-practice rules on (it
 * reported `region`, which is best-practice) and `landmark-unique` never fired.
 * Renaming the mobile one "Sections bottom bar" would have described its
 * position rather than its purpose and made the announcement worse to fix
 * nothing. So the invariant gets enforced instead of the name getting changed —
 * a future breakpoint that exposed both goes red here.
 *
 * Verified by breaking each claim on purpose rather than reasoning about it:
 *
 * | broken on purpose | result |
 * |---|---|
 * | `.sidebar` switched to `display: block` at ≤48rem | 1 red — two exposed "Sections" landmarks at 390px |
 * | drop zone reverted to `div[role="button"][tabindex]` | 1 red — the drop zone's `tagName` is not `BUTTON` |
 * | `StatusBar` root reverted to `<div>` | 1 red — no `footer.status-bar`, so no `contentinfo` |
 * | `aria-label` dropped from the header's file input | 1 red — that input has no accessible name |
 */

vi.mock('../stores/wad.svelte', async () => await import('./__fixtures__/wad-mock.svelte'));
vi.mock('../../wasm/crustyview_web.js', () => ({ version: () => '0.0.0-test' }));

const { render } = await import('vitest-browser-svelte');
const Shell = (await import('./Shell.svelte')).default;
const { wad, resetWadMock } = await import('./__fixtures__/wad-mock.svelte');

const DESKTOP: [number, number] = [1280, 800];
const MOBILE: [number, number] = [390, 844];

/**
 * Whether `el` reaches the accessibility tree, i.e. nothing in its
 * ancestor-or-self chain is `display: none`. That is the exact mechanism the
 * landmark invariant rests on, so the test asserts it directly rather than
 * assuming a media query fired.
 */
function exposed(el: Element): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (getComputedStyle(n).display === 'none') return false;
  }
  return true;
}

function exposedSectionNavs(root: ParentNode): Element[] {
  return [...root.querySelectorAll('nav[aria-label="Sections"]')].filter(exposed);
}

/** Sectioning content — a `<footer>` inside any of these is scoped to it. */
const SECTIONING = new Set(['ARTICLE', 'ASIDE', 'NAV', 'SECTION']);

/**
 * The `<footer>` elements that actually map to the `contentinfo` landmark.
 *
 * Per HTML-AAM a `<footer>` is `contentinfo` only when its nearest sectioning
 * ancestor is the document body — nested inside `<article>` or `<section>` it is
 * a scoped footer with no landmark role at all. Counting `<footer>` tags instead
 * would fail the moment a future view legitimately added a nested one, which is
 * a false positive rather than a caught regression. Raised as a suppressed
 * review comment on #196.
 */
function contentinfoFooters(root: ParentNode & Node): Element[] {
  return [...root.querySelectorAll('footer')].filter((el) => {
    for (let n = el.parentElement; n && n !== root; n = n.parentElement) {
      if (SECTIONING.has(n.tagName)) return false;
    }
    return true;
  });
}

beforeEach(async () => {
  resetWadMock();
  // `empty` so `Shell` renders `EmptyState` (the drop zone) rather than a view,
  // and so no LoadingOverlay covers the shell mid-assertion.
  wad.phase = 'empty';
  wad.summary = null;
  await page.viewport(...DESKTOP);
});

describe('shell landmarks', () => {
  it('exposes exactly one "Sections" nav at desktop width, and it is the sidebar', async () => {
    const screen = await render(Shell);
    await page.viewport(...DESKTOP);

    const navs = exposedSectionNavs(screen.container);
    expect(navs).toHaveLength(1);
    expect(navs[0].classList.contains('sidebar')).toBe(true);

    // Both are in the DOM at all times — the point is that only one is exposed.
    expect(screen.container.querySelectorAll('nav[aria-label="Sections"]')).toHaveLength(2);
  });

  it('exposes exactly one "Sections" nav at mobile width, and it is the bottom nav', async () => {
    const screen = await render(Shell);
    await page.viewport(...MOBILE);

    const navs = exposedSectionNavs(screen.container);
    expect(navs).toHaveLength(1);
    expect(navs[0].classList.contains('bottom-nav')).toBe(true);
  });
});

describe('shell semantics', () => {
  it('wraps the status bar in a contentinfo landmark so the build string sits inside one', async () => {
    const screen = await render(Shell);

    const footer = screen.container.querySelector('footer.status-bar');
    expect(footer, 'the status bar should be a <footer>').not.toBeNull();
    // The whole point of the change: the build string was outside every
    // landmark, which is what axe's `region` rule reported.
    expect(footer?.querySelector('.build')).not.toBeNull();
    // Exactly one *landmark* footer. Scoped footers nested in sectioning content
    // carry no role and are free to appear later without failing this.
    expect(contentinfoFooters(screen.container)).toHaveLength(1);
  });

  it('does not count a scoped footer as a second contentinfo', async () => {
    const screen = await render(Shell);

    // A nested footer inside sectioning content is not a landmark, so adding one
    // must not trip the uniqueness assertion above. Without the HTML-AAM rule in
    // `contentinfoFooters`, a bare tag count goes red here.
    const article = document.createElement('article');
    article.append(document.createElement('footer'));
    screen.container.querySelector('main')?.append(article);

    expect(screen.container.querySelectorAll('footer')).toHaveLength(2);
    expect(contentinfoFooters(screen.container)).toHaveLength(1);
  });

  it('makes the drop zone a real button rather than a div with a button role', async () => {
    const screen = await render(Shell);

    const drop = screen.container.querySelector('.drop');
    expect(drop, 'the empty state should render a drop zone').not.toBeNull();
    expect(drop?.tagName).toBe('BUTTON');
    // The hand-rolled affordances the native element replaces: with a real
    // button there is nothing to re-implement, so neither should remain.
    expect(drop?.hasAttribute('role')).toBe(false);
    expect(drop?.hasAttribute('tabindex')).toBe(false);
    // A button's content model is phrasing content, so the input cannot be
    // inside it — this pins the restructure, not just the tag swap.
    expect(drop?.querySelector('input')).toBeNull();
  });

  it('gives every file input an accessible name', async () => {
    const screen = await render(Shell);

    const inputs = [...screen.container.querySelectorAll('input[type="file"]')];
    // One in the header, one in the empty state's drop zone.
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const input of inputs) {
      expect(
        input.getAttribute('aria-label')?.trim(),
        'a file input should carry a name even while `hidden` keeps it inert',
      ).toBeTruthy();
    }
  });
});
