import { mount } from 'svelte';
import init from './wasm/crustyview_web.js';
import wasmUrl from './wasm/crustyview_web_bg.wasm?url';
import App from './App.svelte';
import './app.css';

async function bootstrap(): Promise<void> {
  const target = document.getElementById('app');
  if (!target) throw new Error('missing #app mount target');
  await init({ module_or_path: wasmUrl });
  mount(App, { target });
}

bootstrap().catch((err: unknown) => {
  // Surface a startup failure (e.g. wasm init) instead of blank-failing with an
  // unhandled rejection.
  console.error('crustyview failed to start:', err);
  const target = document.getElementById('app');
  if (target) {
    target.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
});
