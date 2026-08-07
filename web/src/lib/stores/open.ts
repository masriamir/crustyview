import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

/**
 * Reset navigation, then load a WAD (ADR-0003 lifecycle). Resetting first
 * keeps a superseded call from clobbering newer navigation state — a stale
 * `wad.load` returns early via its load-sequence guard without reaching here
 * again.
 */
export async function openWad(file: File): Promise<void> {
  nav.reset();
  await wad.load(file);
}
