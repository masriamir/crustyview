import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  expectMapCanvasPainted,
  expectTextureCanvasPainted,
  FIXTURES,
  gotoApp,
  haveFixtures,
  loadBrokenMapWad,
  loadJunk,
  loadTinyJunk,
  loadWad,
  mapCanvas,
  mapCanvasPixelHash,
} from './helpers';

test.describe('desktop shell smoke', () => {
  test.skip(!haveFixtures, 'Freedoom fixtures missing — run `just fetch-freedoom` first');

  test('empty state → load → navigate → error → recover', async ({ page }) => {
    await gotoApp(page);

    // Empty state: full-pane drop zone, disabled sections, idle status bar.
    await expect(page.getByRole('button', { name: /Drop a WAD anywhere/ })).toBeVisible();
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await expect(sidebar.getByRole('button', { name: 'Overview' })).toBeDisabled();
    await expect(page.getByRole('status')).toContainText('No WAD loaded');

    // Load: Overview cards + filename + status bar counts.
    await loadWad(page, 'freedoom1.wad');
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await expect(page.locator('header .file')).toContainText('freedoom1.wad');
    await expect(page.locator('.card', { hasText: 'Kind' })).toContainText('IWAD');
    await expect(page.getByRole('status')).toContainText('IWAD');

    // Tree: map entry opens the map view with the 2D/3D mode control.
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Map E1M1' })).toBeVisible();
    const modes = page.getByRole('group', { name: 'Map mode' });
    await expect(modes.getByRole('button', { name: '2D' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const mode3d = modes.getByRole('button', { name: /^3D/ });
    await expect(mode3d).toHaveAttribute('aria-disabled', 'true');
    await mode3d.click({ force: true });
    await expect(modes.getByRole('button', { name: '2D' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Texture canvas actually paints; lump stub renders its count.
    await sidebar.getByRole('button', { name: 'Textures' }).click();
    await expectTextureCanvasPainted(page);
    await sidebar.getByRole('button', { name: 'Lumps' }).click();
    await expect(page.getByText(/lumps in the directory/)).toBeVisible();

    // Junk file: alert banner, sections disabled again.
    await loadJunk(page);
    await expect(page.getByRole('alert')).toContainText('Error:');
    await expect(sidebar.getByRole('button', { name: 'Overview' })).toBeDisabled();

    // Recovery with a second WAD.
    await loadWad(page, 'freedoom2.wad');
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'MAP01', exact: true })).toBeVisible();
  });

  test('2D map view: paints, zooms, toggles layers, and reports cursor position', async ({
    page,
  }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Map E1M1' })).toBeVisible();
    await expectMapCanvasPainted(page);

    const canvas = mapCanvas(page);
    await expect(canvas).toHaveAccessibleDescription(/arrow keys to pan/);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('map canvas has no layout box');

    // Zoom readout starts at the fit scale and moves off it on a wheel gesture
    // over the canvas.
    const zoomLabel = page.getByTitle('Zoom, relative to the fitted view');
    await expect(zoomLabel).toHaveText('×1.0');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -240);
    await expect(zoomLabel).not.toHaveText('×1.0');

    // Layer toggles flip their pressed state and don't error round-tripping.
    const tools = page.getByRole('group', { name: '2D map view controls' });
    const grid = tools.getByRole('button', { name: 'Show grid' });
    const gridBefore = await grid.getAttribute('aria-pressed');
    await grid.click();
    await expect(grid).toHaveAttribute('aria-pressed', gridBefore === 'true' ? 'false' : 'true');

    const things = tools.getByRole('button', { name: 'Show things' });
    const thingsBefore = await things.getAttribute('aria-pressed');
    await things.click();
    await expect(things).toHaveAttribute(
      'aria-pressed',
      thingsBefore === 'true' ? 'false' : 'true',
    );
    await things.click();
    await expect(things).toHaveAttribute('aria-pressed', thingsBefore ?? 'false');

    // Hovering the canvas reports the map-space coordinate in the status bar.
    // The span is `aria-hidden`, so locate by its text, not by role.
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText(/\(-?\d+, -?\d+\)/)).toBeVisible();
  });

  test('thing category chips filter markers and act as a legend', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const chips = page.getByRole('group', { name: 'Thing category filters' });
    await expect(chips).toBeVisible();
    const monsters = chips.getByRole('button', { name: /^Monsters/ });
    await expect(monsters).toHaveAttribute('aria-pressed', 'true');
    await expect(monsters).toHaveText(/[1-9]/); // Freedoom E1M1 has monsters

    // Hiding a populated category changes the canvas; restoring it restores
    // the exact pixels (the draw is deterministic).
    const before = await mapCanvasPixelHash(page);
    await monsters.click();
    await expect(monsters).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(before);
    await monsters.click();
    await expect.poll(() => mapCanvasPixelHash(page)).toBe(before);

    // The master Things toggle owns the whole row.
    const tools = page.getByRole('group', { name: '2D map view controls' });
    await tools.getByRole('button', { name: 'Show things' }).click();
    await expect(chips).not.toBeVisible();
    await tools.getByRole('button', { name: 'Show things' }).click();
    await expect(chips).toBeVisible();
  });

  test('teleport line chip toggles the dashed overlay', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M2', exact: true }).click();
    await expectMapCanvasPainted(page);

    const chips = page.getByRole('group', { name: 'Line overlay filters' });
    await expect(chips).toBeVisible();
    const chip = chips.getByRole('button', { name: /^Teleport lines/ });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(chip).toHaveText(/[1-9]/);

    // Hiding the overlay changes the canvas; restoring it restores the exact
    // pixels (the draw is deterministic).
    const before = await mapCanvasPixelHash(page);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(before);
    await chip.click();
    await expect.poll(() => mapCanvasPixelHash(page)).toBe(before);
  });

  test('sector overlay chips toggle secret and damage boundaries', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const chips = page.getByRole('group', { name: 'Line overlay filters' });
    await expect(chips).toBeVisible();
    const secrets = chips.getByRole('button', { name: /^Secrets/ });
    const damage = chips.getByRole('button', { name: /^Damage/ });
    // Default OFF — revealing secrets is opt-in.
    await expect(secrets).toHaveAttribute('aria-pressed', 'false');
    await expect(damage).toHaveAttribute('aria-pressed', 'false');
    await expect(secrets).toHaveText(/[1-9]/);
    await expect(damage).toHaveText(/[1-9]/);

    // Enabling an overlay changes the canvas; disabling restores the exact
    // pixels (the draw is deterministic).
    const before = await mapCanvasPixelHash(page);
    await secrets.click();
    await expect(secrets).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(before);
    await secrets.click();
    await expect(secrets).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasPixelHash(page)).toBe(before);

    await damage.click();
    await expect(damage).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(before);
    await damage.click();
    await expect(damage).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasPixelHash(page)).toBe(before);
  });

  test('player start toggle governs the arrow independently of Things', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const tools = page.getByRole('group', { name: '2D map view controls' });
    const start = tools.getByRole('button', { name: 'Always show player start' });
    await expect(start).toHaveAttribute('aria-pressed', 'true');

    // With Things off, the arrow alone remains — and answers only to Start.
    // Poll past the things-off redraw (rAF-scheduled) before trusting the canvas.
    const withThings = await mapCanvasPixelHash(page);
    await tools.getByRole('button', { name: 'Show things' }).click();
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(withThings);
    const before = await mapCanvasPixelHash(page);
    await start.click();
    await expect(start).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasPixelHash(page)).not.toBe(before);
    await start.click();
    await expect(start).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasPixelHash(page)).toBe(before);

    // The off state survives a reload. No URL router: reloading drops the
    // loaded WAD, so re-load and re-navigate before asserting.
    await start.click();
    await expect(start).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await loadWad(page, 'freedoom1.wad');
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'E1M1', exact: true })
      .click();
    await expectMapCanvasPainted(page);
    await expect(
      page
        .getByRole('group', { name: '2D map view controls' })
        .getByRole('button', { name: 'Always show player start' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  test('bracket keys adjust the grid size and enable the grid', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const tools = page.getByRole('group', { name: '2D map view controls' });
    const grid = tools.getByRole('button', { name: 'Show grid' });
    await expect(grid).toHaveAttribute('aria-pressed', 'false');
    await expect(grid).toHaveText(/Grid · 32/);

    await mapCanvas(page).focus();
    await page.keyboard.press(']');
    await expect(grid).toHaveText(/Grid · 64/);
    // Adjusting while hidden turns the grid on.
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('[');
    await expect(grid).toHaveText(/Grid · 32/);

    // The size survives a reload (no URL router: re-load and re-navigate first).
    await page.keyboard.press(']');
    await expect(grid).toHaveText(/Grid · 64/);
    await page.reload();
    await loadWad(page, 'freedoom1.wad');
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'E1M1', exact: true })
      .click();
    await expectMapCanvasPainted(page);
    await expect(
      page
        .getByRole('group', { name: '2D map view controls' })
        .getByRole('button', { name: 'Show grid' }),
    ).toHaveText(/Grid · 64/);
  });

  test('the grid label reports draw-time coarsening', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const grid = page
      .getByRole('group', { name: '2D map view controls' })
      .getByRole('button', { name: 'Show grid' });

    // Step down to base 1 (32 → 16 → 8 → 4 → 2 → 1). At base 1, coarsening is
    // guaranteed on any real map at any viewport, so this does not depend on the
    // fixture's extent. `[` also enables the grid, which the bracket-key spec
    // already relies on.
    await mapCanvas(page).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('[');

    await expect(grid).toHaveText(/Grid · 1→\d+/);
  });

  test('the grid button exposes the drawn size in its accessible name', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const grid = page
      .getByRole('group', { name: '2D map view controls' })
      .getByRole('button', { name: 'Show grid' });

    // Step down to base 1 (32 → 16 → 8 → 4 → 2 → 1), where coarsening is
    // guaranteed on any real map at any viewport. `[` also enables the grid.
    await mapCanvas(page).focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press('[');

    await expect(grid).toHaveAccessibleName(/Show grid, 1, drawn as \d+/);
  });

  test('selecting a map shows its stats in the status bar', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('button', { name: 'E1M1', exact: true })
      .click();
    await expectMapCanvasPainted(page);

    const bar = page.getByRole('status').filter({ hasText: 'IWAD' });
    await expect(bar).toContainText(/THINGS [1-9]\d*/);
    await expect(bar).toContainText(/VERTEXES [1-9]\d*/);
    await expect(bar).toContainText(/LINEDEFS [1-9]\d*/);
    await expect(bar).toContainText(/SECTORS [1-9]\d*/);
  });

  test('build string renders before any WAD loads and sits outside the live region', async ({
    page,
  }) => {
    await gotoApp(page);

    // Visible in the empty state — a build id is most useful when a load failed.
    const build = page.locator('.status-bar .build');
    await expect(build).toBeVisible();
    await expect(page.locator('.status-bar .build-text')).toHaveText(
      /^v\d+\.\d+\.\d+( · [0-9a-f]{7,})?$/,
    );
    // The visually-hidden span carries the full announcement for assistive tech.
    await expect(page.locator('.status-bar .build .visually-hidden')).toHaveText(/^Build v\d/);

    // The polite live region must not contain it, or every load announcement
    // would drag the build string along with it. Assert this structurally rather
    // than by text, so the check survives the version reaching 1.x.
    await expect(page.locator('[role="status"] .build')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('No WAD loaded');
  });

  test('replacing a WAD keeps the previous view mounted', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    await expect(page.locator('main')).toContainText('freedoom1.wad');

    // Sample <main> every frame across the second load. Assert DOM *presence* of
    // the Overview heading, not visibility: a slow CI runner may legitimately
    // reveal the loading overlay on top of it, and that must not flake the test.
    await page.evaluate(() => {
      const w = window as unknown as { __sawTeardown: boolean; __stop: boolean };
      w.__sawTeardown = false;
      w.__stop = false;
      const tick = () => {
        const main = document.querySelector('main');
        if (!main?.textContent?.includes('Overview')) w.__sawTeardown = true;
        if (!w.__stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page
      .locator('header input[type="file"]')
      .setInputFiles(path.join(FIXTURES, 'freedoom2.wad'));
    await expect(page.locator('main')).toContainText('freedoom2.wad');

    const sawTeardown = await page.evaluate(() => {
      const w = window as unknown as { __sawTeardown: boolean; __stop: boolean };
      w.__stop = true;
      return w.__sawTeardown;
    });
    expect(sawTeardown).toBe(false);
  });

  test('every map-toolbar control has been considered for explanatory text', async ({ page }) => {
    // Recorded by #74's audit: controls whose visible label is the whole story.
    // A tooltip restating a clear label is noise, so these are deliberate.
    const NO_TOOLTIP_NEEDED = ['Monsters', 'Weapons', 'Ammo', 'Keys'];

    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    const groups = ['2D map view controls', 'Thing category filters', 'Line overlay filters'];
    for (const group of groups) {
      const buttons = await page.getByRole('group', { name: group }).getByRole('button').all();
      // Guard the guard, per group: a cumulative floor across all three groups would
      // still pass if any *one* group's selector silently matched nothing — this
      // catches that failure regardless of which group it happens to.
      //
      // Measured, not assumed: both chip-group wrappers are conditionally rendered
      // on map content — `Thing category filters` needs `showThings && totalThings >
      // 0 && counts !== null`, and `Line overlay filters` needs at least one teleport
      // line, secret sector, or damaging sector — so a legitimately-absent group is
      // indistinguishable from a renamed one. This assertion only works because it
      // pins freedoom1 E1M1, where all three groups render.
      expect(
        buttons.length,
        `Toolbar group "${group}" matched no buttons — it was renamed or removed, so every ` +
          `control inside it is going unchecked.`,
      ).toBeGreaterThan(0);

      for (const button of buttons) {
        const label = (await button.innerText()).trim().replace(/\s+/g, ' ');
        const title = await button.getAttribute('title');
        // `startsWith`, not equality: a chip's text is its label followed by its
        // count ("Monsters 53"), and the count changes with the map.
        expect(
          title !== null || NO_TOOLTIP_NEEDED.some((l) => label.startsWith(l)),
          `Toolbar control "${label}" has no explanatory text and is not in #74's recorded ` +
            `no-tooltip list. Add a title, or add it to NO_TOOLTIP_NEEDED if its label says everything.`,
        ).toBe(true);
      }
    }
  });

  test('a category with no things explains why it is unavailable', async ({ page }) => {
    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');
    const sidebar = page.getByRole('navigation', { name: 'Sections' });
    await sidebar.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expectMapCanvasPainted(page);

    // Measured, not assumed: on freedoom1 E1M1, `teleports` is the only zero-count
    // category (monsters 53, coop 3, deathmatch 8, weapons 10, ammo 44, health 67,
    // powerups 1, keys 1, teleports 0, decorations 104, other 1). E1M2 has none,
    // so this pins E1M1.
    const chip = page
      .getByRole('group', { name: 'Thing category filters' })
      .getByRole('button', { name: /^Teleports/ });

    await expect(chip).toHaveAttribute('aria-disabled', 'true');
    await expect(chip).toHaveAttribute('title', 'No teleports on this map');
    // Proves the chip is not natively `disabled`: a real `disabled` button refuses
    // focus outright, so this one taking it shows `aria-disabled` is doing the work
    // instead. (Not `toBeEnabled()`: Playwright's isEnabled treats `aria-disabled="true"`
    // as disabled too — `getAriaDisabled()` in playwright-core ORs the native
    // `disabled` check with an explicit aria-disabled check for button-like roles —
    // so it can't tell the two apart.)
    await chip.focus();
    await expect(chip).toBeFocused();
    await expect(chip).toHaveAccessibleName(/No teleports on this map/);
  });
});

test('sub-header-size file shows a clean error message', async ({ page }) => {
  await gotoApp(page);
  await loadTinyJunk(page);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('failed to parse WAD header');
  const text = (await alert.textContent()) ?? '';
  expect(text).not.toContain('\u001b'); // no raw ANSI escapes
  expect(text).not.toContain('Backtrace');
  expect(text).not.toContain('.cargo/registry');
});

test('broken map shows the real assembly error', async ({ page }) => {
  await gotoApp(page);
  await loadBrokenMapWad(page);
  await page
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('button', { name: 'MAP01', exact: true })
    .click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Could not assemble MAP01');
  await expect(alert).toContainText('missing required lump VERTEXES');
  const text = (await alert.textContent()) ?? '';
  expect(text).not.toContain('\u001b'); // no raw ANSI escapes
  expect(text).not.toContain('Backtrace');
});

test('theme toggle persists across reload', async ({ page }) => {
  await gotoApp(page);
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const flipped = initial === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);
});

// Outside the fixture-gated `describe` above: the header renders before any
// WAD is opened, so gating this on Freedoom would make it skip silently on a
// machine without fixtures.
test.describe('header wordmark', () => {
  test('renders in the pixel font, not a fallback', async ({ page }) => {
    await gotoApp(page);
    // Await inside the page: `document.fonts.ready` resolves to a FontFaceSet,
    // which does not cross the Playwright boundary as a useful value.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });

    const h1 = page.getByRole('heading', { name: 'crustyview' });
    await expect(h1).toBeVisible();

    // The DOM text is the product name; the capitals are presentation only.
    await expect(h1).toHaveText('crustyview');
    await expect(h1).toHaveCSS('text-transform', 'uppercase');
    await expect(h1).toHaveCSS('font-size', '32px');
    // Regular weight only — an h1 defaults to bold, and the face ships only a
    // regular weight, so a bold declaration would smear the pixel grid with
    // synthetic emboldening while leaving the wordmark's width unchanged.
    await expect(h1).toHaveCSS('font-weight', '400');

    // 10 glyphs x 0.5625 em x 32px = 180px, only if our font actually drew them.
    const width = await h1.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(179);
    expect(width).toBeLessThan(181);

    // Diagnostic: separates "never loaded" from "loaded but not applied".
    const loaded = await page.evaluate(() => document.fonts.check('32px "Web437 IBM VGA"'));
    expect(loaded, 'the subset font should be loaded').toBe(true);
  });
});
