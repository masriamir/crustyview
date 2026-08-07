import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Vitest must resolve Svelte's browser build so rune-using .svelte.ts
  // modules load under the simulated DOM.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
