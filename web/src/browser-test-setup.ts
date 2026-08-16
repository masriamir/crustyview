/**
 * Setup for the `browser` Vitest project (#158).
 *
 * The browser tier gives each spec file a bare page. Nothing plays the role
 * `main.ts` plays in the app — nothing imports `app.css` — so none of the
 * `--map2d-*` design tokens are defined, and `resolvePalette`'s `token()`
 * lookups all miss and return their classic fallbacks.
 *
 * The effect was that **every browser spec rendered the classic palette**,
 * whichever style it believed it had selected. `mapPrefs.style = 'theme'` and
 * `'classic'` produced identical pixels, so a spec could assert a themed color,
 * pass, and be observing the fallback the whole time. Worse, the failure was
 * silent in the dangerous direction: deleting `--map2d-wall` from `app.css`
 * breaks the app and *passes* the suite, because the fallback covers for it.
 *
 * Loading the stylesheet here rather than per-spec is what makes the tier able
 * to see the token path at all. `tile-cache.browser.test.ts` previously carried
 * this import itself — it was the one spec that could not be written without it,
 * since its style-toggle case needs the two palettes to actually differ.
 *
 * Note this defines the **light** theme: `app.css` gates dark on
 * `:root[data-theme='dark']` and uses no `prefers-color-scheme` media query, so
 * the tokens a spec sees do not depend on the runner's appearance settings. A
 * spec wanting the dark values sets that attribute on `document.documentElement`
 * itself.
 */
import './app.css';
