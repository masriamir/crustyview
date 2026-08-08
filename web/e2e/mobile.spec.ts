import { expect, test } from '@playwright/test';
import {
  expectMapCanvasPainted,
  expectTextureCanvasPainted,
  gotoApp,
  haveFixtures,
  loadWad,
  mapCanvas,
} from './helpers';

test.describe('mobile shell smoke', () => {
  test.skip(!haveFixtures, 'Freedoom fixtures missing — run `just fetch-freedoom` first');

  test('bottom-nav sections and map push navigation', async ({ page }) => {
    await gotoApp(page);

    // Compact chrome: bottom nav in, sidebar and status bar out.
    const bottomNav = page.locator('nav.bottom-nav');
    await expect(bottomNav).toBeVisible();
    await expect(page.locator('nav.sidebar')).toBeHidden();
    await expect(page.locator('.status-bar')).toBeHidden();

    await loadWad(page, 'freedoom1.wad');
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

    // Push navigation: Maps → list → full-screen map view → back.
    await bottomNav.getByRole('button', { name: 'Maps' }).click();
    await expect(page.getByRole('heading', { name: /^Maps \(\d+\)/ })).toBeVisible();
    await page.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Map E1M1' })).toBeVisible();
    const back = page.getByRole('button', { name: 'Back to the map list' });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByRole('heading', { name: /^Maps \(\d+\)/ })).toBeVisible();

    // Remaining sections render; texture canvas paints on mobile too.
    await bottomNav.getByRole('button', { name: 'Textures' }).click();
    await expectTextureCanvasPainted(page);
    await bottomNav.getByRole('button', { name: 'Lumps' }).click();
    await expect(page.getByText(/lumps in the directory/)).toBeVisible();
    await bottomNav.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByRole('region', { name: 'Overview' })).toBeVisible();

    // The shell never scrolls horizontally on compact width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test('2D map view renders full-screen and survives a drag pan', async ({ page }) => {
    // Playwright does not fail a test on an uncaught page exception by
    // default, and a mid-handler throw in the pointer handlers wouldn't
    // necessarily un-paint the canvas (the last fully-drawn frame stays put)
    // — so "must not throw" needs its own explicit assertion, not just the
    // paint check below. Attached before any interaction for full coverage.
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await gotoApp(page);
    await loadWad(page, 'freedoom1.wad');

    await page.locator('nav.bottom-nav').getByRole('button', { name: 'Maps' }).click();
    await page.getByRole('button', { name: 'E1M1', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Map E1M1' })).toBeVisible();
    await expectMapCanvasPainted(page);

    const canvas = mapCanvas(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('map canvas has no layout box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // A touch-context pointer drag (down, move, up) must not throw, and the
    // canvas must still be painted afterward (not blanked by the pan).
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 40, cy - 40, { steps: 5 });
    await page.mouse.up();

    await expectMapCanvasPainted(page);
    expect(pageErrors).toEqual([]);
  });
});
