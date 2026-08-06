import { mount } from 'svelte';
import init from './wasm/crustyview_web.js';
import wasmUrl from './wasm/crustyview_web_bg.wasm?url';
import App from './App.svelte';
import './app.css';

async function bootstrap(): Promise<void> {
  await init(wasmUrl);
  const target = document.getElementById('app');
  if (target) mount(App, { target });
}

void bootstrap();
