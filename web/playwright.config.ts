import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // `a11y.spec.ts` is matched by BOTH projects on purpose (#61): it walks the
    // same app states at each viewport, so the compact layout is scanned without
    // a second copy of the walk.
    // Explicit globs rather than a regex alternation: an unanchored
    // /(desktop|a11y)\.spec\.ts/ also matches any filename merely *containing*
    // those words, so a future `notdesktop.spec.ts` would silently join the
    // desktop project.
    {
      name: 'desktop',
      testMatch: ['**/desktop.spec.ts', '**/a11y.spec.ts'],
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testMatch: ['**/mobile.spec.ts', '**/a11y.spec.ts'],
      use: { viewport: { width: 390, height: 844 }, hasTouch: true },
    },
  ],
});
