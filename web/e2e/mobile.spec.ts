import { expect, test } from '@playwright/test';
import { expectTextureCanvasPainted, gotoApp, haveFixtures, loadWad } from './helpers';

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
});
