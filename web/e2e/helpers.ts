import { expect, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo-root fixture directory populated by `just fetch-freedoom`. */
export const FIXTURES = path.resolve(here, '../../.freedoom');

export const haveFixtures = ['freedoom1.wad', 'freedoom2.wad'].every((wad) =>
  fs.existsSync(path.join(FIXTURES, wad)),
);

/** Navigate to the app and wait for the wasm bootstrap to mount the shell. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'crustyview' })).toBeVisible();
}

/** Load a fixture WAD through the header Open input. */
export async function loadWad(page: Page, wadName: string): Promise<void> {
  await page
    .locator('header input[type="file"]')
    .setInputFiles(path.join(FIXTURES, wadName));
}

/** Feed a non-WAD payload (≥12 bytes, bad magic) through the header Open input. */
export async function loadJunk(page: Page): Promise<void> {
  await page.locator('header input[type="file"]').setInputFiles({
    name: 'junk.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is definitely not a wad'),
  });
}

/** Assert the Textures view's first-texture canvas has non-blank pixels. */
export async function expectTextureCanvasPainted(page: Page): Promise<void> {
  const canvas = page.getByRole('img', { name: 'Composited first-texture preview' });
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        const ctx = c.getContext('2d');
        if (!ctx || c.width === 0 || c.height === 0) return false;
        return ctx.getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0);
      }),
    )
    .toBe(true);
}
