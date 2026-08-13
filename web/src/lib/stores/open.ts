import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

/**
 * Reset navigation, load a WAD, then reset again if the load committed
 * (ADR-0003 lifecycle).
 *
 * The first reset parks the view on Overview, which reads only plain data, so
 * nothing queries the outgoing `WadDocument` as it is freed mid-commit (#57).
 * The second corrects navigation the user performed *during* the load — the
 * sidebar still lists the outgoing WAD's maps and stays clickable (#123).
 *
 * Gating on `load`'s return rather than on `wad.phase` is what makes this
 * race-free: a superseded load whose await resolves after the winner committed
 * would observe `'loaded'` and reset over newer navigation.
 */
export async function openWad(file: File): Promise<void> {
  nav.reset();
  if (await wad.load(file)) nav.reset();
}
