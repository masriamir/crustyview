import { expect, test } from '@playwright/test';
import {
  expectTextureCanvasPainted,
  gotoApp,
  haveFixtures,
  loadJunk,
  loadTinyJunk,
  loadWad,
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
