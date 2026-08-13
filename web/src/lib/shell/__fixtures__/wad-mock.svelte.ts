/**
 * A reactive stand-in for the `wad` store, used only by
 * `shell-loading.browser.test.ts`. `Shell`'s `showContent` and `showOverlay`
 * `$derived`s only re-run when what they read is rune-backed state — a plain
 * object literal handed to `vi.mock`'s inline factory does not qualify, since
 * mutating one of its properties later is invisible to Svelte's reactivity.
 * Runes are unavailable in a bare `.ts` module, so this mock lives in its own
 * `.svelte.ts` file instead, mirroring how `wad.svelte.ts` itself is built.
 * The test imports `wad` directly and mutates its fields to drive a second
 * load through an already-mounted `Shell`.
 */

interface WadMockShape {
  phase: 'empty' | 'loading' | 'loaded' | 'error';
  summary: { kind: string; lump_count: number; map_count: number; game: string | null } | null;
  mapNames: string[];
  fileName: string | null;
  loadingFileName: string | null;
  error: string | null;
  mapStats: (name: string) => null;
}

/**
 * Starting point for every test: a load in progress, with a previous WAD's
 * summary still present so `Shell`'s `showContent` is true — the outgoing
 * WAD's view stays mounted while the replacement loads, which is what the
 * overlay covers.
 */
const INITIAL: WadMockShape = {
  phase: 'loading',
  summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
  mapNames: ['MAP01'],
  fileName: 'outgoing.wad',
  loadingFileName: 'incoming.wad',
  error: null,
  mapStats: () => null,
};

export const wad = $state({ ...INITIAL });

/** Restore every field to its starting value. Call from `beforeEach`, since
 * `wad` is a module-level singleton shared by every test in the file. */
export function resetWadMock(): void {
  Object.assign(wad, INITIAL);
}
