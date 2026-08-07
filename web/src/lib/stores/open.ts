import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

/** Load a WAD and reset navigation to the new document (ADR-0003 lifecycle). */
export async function openWad(file: File): Promise<void> {
  await wad.load(file);
  nav.reset();
}
