import { nav } from './nav.svelte';
import { wad } from './wad.svelte';

/**
 * Reset navigation, load a WAD, then reset again if the load committed
 * (ADR-0003 lifecycle).
 *
 * The first reset parks the view on Overview, which reads only plain data, so
 * nothing queries the outgoing `WadDocument` as it is freed mid-commit (#57).
 *
 * The second is a no-op today and deliberately kept: nothing can currently
 * change `nav` mid-load, because `Sidebar` and `BottomNav` disable every
 * control unless `wad.phase === 'loaded'`. It makes "navigation does not
 * survive a load" an invariant of this function rather than something that
 * happens to hold while two components remember to check the phase — so
 * enabling navigation during loads later cannot silently strand the user on a
 * map name from the outgoing WAD (#123, whose original repro did not exist).
 *
 * Gating on `load`'s return rather than on `wad.phase` is what makes that
 * second reset race-free: a superseded load whose await resolves after the
 * winner committed would observe `'loaded'` and reset over newer navigation.
 */
export async function openWad(file: File): Promise<void> {
  nav.reset();
  if (await wad.load(file)) nav.reset();
}
