import { expect, test } from '@playwright/test';
import {
  expectMapCanvasPainted,
  expectTextureCanvasPainted,
  gotoApp,
  haveFixtures,
  loadJunk,
  loadTinyJunk,
  loadWad,
  mapCanvas,
  mapCanvasDataUrl,
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
    const before = await mapCanvasDataUrl(page);
    await monsters.click();
    await expect(monsters).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(before);
    await monsters.click();
    await expect.poll(() => mapCanvasDataUrl(page)).toBe(before);

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
    const before = await mapCanvasDataUrl(page);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(before);
    await chip.click();
    await expect.poll(() => mapCanvasDataUrl(page)).toBe(before);
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
    const before = await mapCanvasDataUrl(page);
    await secrets.click();
    await expect(secrets).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(before);
    await secrets.click();
    await expect(secrets).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasDataUrl(page)).toBe(before);

    await damage.click();
    await expect(damage).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(before);
    await damage.click();
    await expect(damage).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasDataUrl(page)).toBe(before);
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
    const withThings = await mapCanvasDataUrl(page);
    await tools.getByRole('button', { name: 'Show things' }).click();
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(withThings);
    const before = await mapCanvasDataUrl(page);
    await start.click();
    await expect(start).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => mapCanvasDataUrl(page)).not.toBe(before);
    await start.click();
    await expect(start).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => mapCanvasDataUrl(page)).toBe(before);

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

test('theme toggle persists across reload', async ({ page }) => {
  await gotoApp(page);
  const initial = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const flipped = initial === 'dark' ? 'light' : 'dark';
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped);
});
