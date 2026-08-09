import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

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
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
