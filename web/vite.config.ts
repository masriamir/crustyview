import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';

/**
 * Short git SHA of the tree being built. Falls back to 'unknown' outside a git
 * checkout (a source tarball, or a container build that copies without .git) —
 * the status bar then shows the bare version rather than a broken string.
 */
function buildSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [svelte()],
  define: { __BUILD_SHA__: JSON.stringify(buildSha()) },
  // Vitest must resolve Svelte's browser build so rune-using .svelte.ts
  // modules load under the simulated DOM.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    projects: [
      {
        // Fast tier: pure modules and stores under a simulated DOM. Behaviorally
        // unchanged from before browser mode existed — `npm test` runs only this.
        extends: true,
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        // Slow tier: real Chromium, so a real canvas 2D context and fake timers
        // are both available — the combination `happy-dom` cannot provide, and
        // what Svelte lifecycle and reactivity bugs need (#129).
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            // v4 moved providers into their own packages and takes a factory
            // here; v3's `provider: 'playwright'` string no longer applies.
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
