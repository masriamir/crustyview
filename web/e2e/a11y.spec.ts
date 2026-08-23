import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Result } from 'axe-core';
import { gotoApp, haveFixtures, loadJunk, loadWad } from './helpers';

/**
 * Automated accessibility scanning (#61), the first of ADR-0007's enforcement
 * tiers.
 *
 * Runs under BOTH Playwright projects, so every state below is scanned at
 * desktop and mobile widths. The compact layout therefore gets covered without
 * a second copy of the walk, and the mobile run picks up the map list on its
 * way to the map view.
 *
 * **What fails and what only warns.** ADR-0007 adopts WCAG 2.2 AA, so a
 * violation carrying any tag in `BLOCKING_TAGS` fails the test. Everything else
 * axe reports — its `best-practice` rules, which map to no WCAG success
 * criterion — is logged and left advisory. Both come from a single scan:
 * filtering by `withTags` would need two passes, and `violation.tags` already
 * carries what the split needs.
 *
 * **Posture: advisory for now.** This lands inside `web-e2e`, which is
 * deliberately not a required check. Promoting it is a separate decision once it
 * has run green for a stretch — the same path `web-browser-test` took in #140.
 * Until then a violation here reddens a job nobody is gated on, which is the
 * point of landing it early rather than late.
 *
 * **No rule exclusions, deliberately.** An excluded rule is a gate that does not
 * gate. #183 (light-theme selected-nav contrast) and #188 (the `region`
 * advisory on the build span) were the two findings from #51's baseline audit
 * that would have reddened this from day one; both shipped before this landed,
 * so the scan starts from a clean floor. Anything that surfaces later is a
 * defect to fix or a decision to record, never an entry in an ignore list.
 */

/** A violation carrying any of these fails. ADR-0007: WCAG 2.2 Level AA. */
const BLOCKING_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** axe-core documents no `wcag22a` tag — 2.2 added no Level A criteria that it
 * tags separately — so the list above is the complete A + AA surface. */
type Theme = 'light' | 'dark';

/** Render one violation as something the person who tripped it can act on. */
function describeViolation(v: Result): string {
  const where = v.nodes
    .slice(0, 5)
    .map((n) => `      ${n.target.join(' ')}`)
    .join('\n');
  const more = v.nodes.length > 5 ? `\n      …and ${v.nodes.length - 5} more` : '';
  return `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${where}${more}`;
}

/**
 * Scan the current page, fail on WCAG violations, log anything advisory.
 *
 * `state` names the app state rather than the URL, since this is a router-less
 * SPA (ADR-0003) and every state shares one address — without it a failure
 * message could not say where it happened.
 */
async function scan(page: Page, testInfo: TestInfo, state: string, theme: Theme): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  const blocking: Result[] = [];
  const advisory: Result[] = [];
  for (const v of results.violations) {
    (v.tags.some((t) => BLOCKING_TAGS.includes(t)) ? blocking : advisory).push(v);
  }

  const where = `${testInfo.project.name} · ${state} · ${theme} theme`;
  if (advisory.length > 0) {
    // Best-practice rules carry no WCAG criterion, so they inform rather than
    // gate. Logged rather than attached: the HTML report is only uploaded on
    // failure, so an attachment on a passing run would never be seen.
    console.log(
      `axe advisory — ${where}:\n${advisory.map(describeViolation).join('\n')}`,
    );
  }

  expect(
    blocking,
    blocking.length === 0
      ? ''
      : `WCAG 2.2 AA violations — ${where}\n${blocking.map(describeViolation).join('\n')}`,
  ).toEqual([]);
}

/** Flip the shell to dark and back, so each state is scanned in both palettes. */
async function withDarkTheme(page: Page, run: () => Promise<void>): Promise<void> {
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await run();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
}

/** Scan `state` in both themes. */
async function scanBothThemes(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  await scan(page, testInfo, state, 'light');
  await withDarkTheme(page, () => scan(page, testInfo, state, 'dark'));
}

test.describe('accessibility scan', () => {
  test('empty shell and load error have no WCAG violations', async ({ page }, testInfo) => {
    // Neither state needs a WAD, so this one runs without the fixtures.
    await gotoApp(page);
    await scanBothThemes(page, testInfo, 'empty shell');

    await loadJunk(page);
    await expect(page.getByRole('alert')).toBeVisible();
    await scanBothThemes(page, testInfo, 'load error');
  });

  test('loaded WAD views have no WCAG violations', async ({ page }, testInfo) => {
    test.skip(!haveFixtures, 'Freedoom fixtures missing — run `just fetch-freedoom` first');
    test.slow(); // Ten scans (five states x two themes), plus the WAD load.

    // The two layouts reach the same views by different routes, so the walk
    // branches here rather than pretending they are the same app. Desktop lists
    // the maps in the sidebar permanently; compact pushes a separate list view,
    // which is itself a state worth scanning and exists nowhere on desktop.
    const compact = testInfo.project.name === 'mobile';

    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    // Readiness signal chosen to work at BOTH widths: the status bar is
    // `display: none` below 48rem (#185), so `role="status"` is absent there and
    // asserting on it would fail the compact run for a reason unrelated to a11y.
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await scanBothThemes(page, testInfo, 'overview');

    if (compact) {
      await page.getByRole('navigation').getByRole('button', { name: 'Maps' }).click();
      await expect(page.getByRole('heading', { name: /^Maps \(\d+\)/ })).toBeVisible();
      await scanBothThemes(page, testInfo, 'map list');
    }

    // Desktop reaches this straight from the sidebar; the disclosure is already
    // expanded, and clicking it would collapse the list instead of opening a map.
    await page.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Map E1M1' })).toBeVisible();
    await scanBothThemes(page, testInfo, 'map view');

    // Every scan waits for its view to actually be on screen first. Without it
    // the scan can race the navigation and audit the previous state, which fails
    // in the worse direction: a stale-but-clean view reports a pass for a state
    // that was never examined.
    await page.getByRole('navigation').getByRole('button', { name: 'Textures' }).click();
    await expect(page.getByRole('region', { name: 'Textures' })).toBeVisible();
    await scanBothThemes(page, testInfo, 'textures');

    await page.getByRole('navigation').getByRole('button', { name: 'Lumps' }).click();
    await expect(page.getByRole('region', { name: 'Lumps' })).toBeVisible();
    await scanBothThemes(page, testInfo, 'lumps');
  });
});
