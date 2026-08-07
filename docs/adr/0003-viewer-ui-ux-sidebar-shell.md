# ADR-0003: Viewer UI/UX — sidebar shell, state-driven navigation, tokened theming

- **Status:** Accepted
- **Date:** 2026-08-06
- **Deciders:** Amir Masri (with collaborative design)
- **Tracking issue / PR:** #18 · PR #20 (`docs/18-adr-0003-viewer-ui-ux`)

## Context and problem statement

Phase 0b (#15) shipped a deliberate single-screen **POC**: a header with a file
drop, then a stats panel and a first-texture preview side by side. Before the
phase-1 2D map lands, the actual application shell must be designed — how
multiple views coexist and navigate, how the texture and lump collections are
browsed, how light/dark theming works, how the app behaves on phones, and how
the Svelte component/state architecture scales toward the 2D map (phase 1) and
the `wgpu` 3D viewport (phase 3). [ADR-0002](0002-hybrid-portable-core-svelte-shell.md)
sketched a placeholder ("a tab bar: Stats / 2D / 3D") but deliberately left the
real UI/UX decision to this ADR.

## Decision drivers

- **The 2D map must land into a designed shell**, not onto the POC — this ADR
  gates phase 1.
- **Navigation must scale by collection size.** Maps are dozens per WAD;
  textures and lumps run to the hundreds and thousands in a commercial IWAD. One
  navigation idiom cannot serve both.
- **Fully mobile-capable.** crustyview is a website; phone use is a first-class
  target — touch-tuned views, not merely "doesn't break when narrow".
- **Not an editor rehearsal.** ADR-0002 already declares the web shell
  "throwaway-OK": no UI or layout reuse toward the eventual native editor is
  expected, so the shell is chosen purely on viewer merits.
- **Preserve the ADR-0002 boundary rule.** Bulk data stays in Rust; the DOM
  panels receive small, on-demand payloads (derived JSON, one texture RGBA at a
  time). The UI architecture must not create pressure to widen that boundary.
- **Fit the established Svelte 5 idiom** — class-with-`$state` rune stores
  (`wad.svelte.ts`), imperative panels via `bind:this` + `onMount`/`onDestroy`.
- **Light and dark from day one**, both first-class.

## Considered options

1. **Simple tabbed viewer** — the ADR-0002 sketch: a top tab bar
   (Stats / Maps / Textures / 3D) over a single pane, with per-tab
   sub-navigation inside.
2. **Sidebar shell** — header, left navigation tree (only Maps expands to
   entries), main content area, status bar; the large collections get in-view
   browsers. *(Chosen.)*
3. **Full editor workspace** — UDB-style dockable panels, central viewport, and
   inspector from day one.

## Decision outcome

Chosen option: **2 — the sidebar shell.** A left tree gives the four sections
*and* the map list one home (no per-tab selector duplication), keeps the main
pane free for data-dense browser views, and degrades cleanly to a bottom
navigation bar on phones. It is chosen on viewer merits alone — per ADR-0002
the shell is throwaway toward the native editor, so no workspace machinery is
built ahead of need.

### Shell anatomy (regular width)

```text
┌──────────────────────────────────────────────┐
│ ⌂ crustyview        DOOM2.WAD  [Open] [☾]    │  header
├──────────┬───────────────────────────────────┤
│ Overview │                                   │
│ Maps  ▾  │                                   │
│   MAP01  │        active view                │
│   MAP02  │                                   │
│ Textures │                                   │
│ Lumps    │                                   │
├──────────┴───────────────────────────────────┤
│ status bar — contextual info                 │
└──────────────────────────────────────────────┘
```

- **Header:** app name, loaded filename, an Open button (file picker; drag/drop
  works anywhere), and the theme toggle.
- **Sidebar tree:** the four sections — **Overview**, **Maps**, **Textures**,
  **Lumps**. Only Maps expands to individual entries, because only the map list
  is bounded (dozens); putting thousands of texture or lump names in the tree
  would make it a scrolling list rather than navigation. The big collections
  are browsed *in-view* instead.
- **Main content area:** hosts exactly one active view.
- **Status bar:** contextual, per-view info (e.g. WAD kind and lump count;
  cursor map coordinates once the 2D view exists). Hidden on compact width.

### Navigation — state-driven, no router

Navigation is plain store state; there is **no URL router**. A deep link cannot
carry the WAD — the file lives on the user's disk and never leaves the machine
(ADR-0001) — so every URL would resolve to the empty drop-zone state anyway.
Back/forward and shareable view state are explicitly out of scope; revisit if
that trade-off changes.

The `nav` store holds the whole navigation state:

```ts
section: 'overview' | 'maps' | 'textures' | 'lumps'
selectedMap: string | null   // which map the map view shows
mapMode: '2d' | '3d'         // mode switch inside the map view
```

Selecting a map in the tree sets `section = 'maps'` and `selectedMap`. With
`selectedMap` still `null`, the maps section shows the map list itself — on
regular width the tree's Maps entry just expands/collapses so this state is
reached only when a WAD has maps but none is selected yet; on compact width it
*is* the map-list screen of the push navigation. The map view is **one view per
map with a `[2D | 3D]` segmented control** — the map is
the unit of navigation, and 2D/3D are modes of inspecting it, not separate
destinations (no duplicated map selectors, no double navigation to compare
modes). The 3D mode renders a disabled placeholder until phase 3.

### The views

- **Overview** — the phase-0b stats content restructured as summary cards
  (WAD kind, lump count, map count, per-category counts). The current
  first-texture preview moves into the texture browser where it belongs.
- **Map view** — title, the 2D/3D segmented control, and the active mode's
  canvas. The 2D map (phase 1) gets pan/zoom from the start.
- **Texture browser** — a search box over a **virtualized thumbnail grid**;
  selecting a texture opens a detail pane (full-size preview plus dimensions
  and patch info). Thumbnails and previews are fetched on demand via the
  ADR-0002 carve-out — `textureRgba(name)`, one texture at a time. (ADR-0002
  already specifies the by-name form; the phase-0b POC exposes a no-argument
  first-texture placeholder, which grows the `name` parameter here.)
- **Lump browser** — a filter box over a **virtualized table** (name, size,
  category) with a detail pane for the selected lump's metadata. A hex preview
  is deliberately out of scope for now.
- **Empty state** — with no WAD loaded, the entire content area is the drop
  zone; the sidebar sections are disabled.

Virtualization is required, not optional: commercial IWADs put thousands of
rows/cells behind these two browsers, and both must stay responsive on phones.

### Theming — design tokens, both themes first-class

- All colors, spacing, and type ramp live as **CSS custom properties** (design
  tokens) on `:root`; components consume tokens only — no hard-coded colors in
  components.
- A `data-theme="light" | "dark"` attribute on `<html>` selects the palette.
  Default follows `prefers-color-scheme`; the header toggle overrides it, and
  the override persists in `localStorage`.
- **Aesthetic: clean tool, subtle Doom accent.** Calm neutral surfaces, a
  single accent color drawn from the red-orange range of the Doom palette
  (PLAYPAL), and monospace for lump names, sizes, and offsets. No pixel fonts,
  no texture-art chrome — the flavor stays in the accents, the focus stays on
  the data.

### Mobile — compact width is a first-class layout

Below the compact breakpoint (~768 px), the shell swaps — not shrinks:

```text
┌────────────────────┐
│ crustyview     [☾] │  header (condensed)
├────────────────────┤
│                    │
│   active view      │
│   (full width)     │
│                    │
├────────────────────┤
│ ⌂    ▦    ▤    ≡   │  bottom nav — 4 sections
└────────────────────┘
```

- The sidebar is replaced by a **bottom navigation bar** with the four
  sections; master-detail becomes **push navigation** (Maps → map-list screen →
  full-screen map view with back).
- **Pointer Events everywhere**; the 2D map supports pinch-zoom and drag-pan;
  interactive targets meet platform touch-target guidelines (≥ 44 px).
- Browsers reflow: the texture grid narrows its columns, the lump table drops
  to its essential columns, detail panes become full-screen pushes.
- The status bar is hidden; the 3D viewport (phase 3) will need touch look/move
  controls — a phase-3 requirement recorded here, not solved here.

### State and lifecycle

State is organized as **domain stores plus component-local ephemera**, following
the existing class-with-`$state` idiom:

```text
web/src/lib/stores/
  wad.svelte.ts     document lifecycle — sole owner of the WadDocument handle
  nav.svelte.ts     section · selectedMap · mapMode
  theme.svelte.ts   'light' | 'dark' | 'system' + persistence
```

Ephemeral view state (search text, scroll position, pan/zoom) is ordinary
component-local state, not global — except the 2D pan/zoom, which is **cached
per map** so returning to a map restores its viewport.

**View lifecycle:** ordinary DOM views unmount on navigation — they are cheap
to rebuild from store state. The **3D viewport is the one exception**: once
attached, it is kept mounted but hidden (CSS `display` swap) with its RAF loop
paused, because `Viewport.attach` is an expensive async `wgpu` initialization
(ADR-0002) and the camera pose should survive navigation. Loading a new WAD
resets the nav store, all caches, and disposes the viewport.

### Component structure

```text
web/src/lib/
  stores/   wad.svelte.ts · nav.svelte.ts · theme.svelte.ts
  shell/    Shell · Header · Sidebar · BottomNav · StatusBar
  views/    Overview · MapView (Map2D, Viewport3D) · TextureBrowser · LumpBrowser
  ui/       SearchInput · VirtualList · ThemeToggle · SegmentedControl
```

Shell components own layout and navigation chrome; views own their content and
local state; `ui/` holds the small reusable primitives the views share.

### Errors, accessibility, testing

- **Per-view degradation** continues from ADR-0002: only `WadDocument.load` is
  fatal (error banner); a view that fails degrades alone while the WAD stays
  loaded.
- **Accessibility:** keyboard-navigable tree and bottom nav, visible focus,
  `prefers-reduced-motion` respected, semantic landmarks (`nav`, `main`,
  `status`).
- **Testing:** Vitest covers the stores (navigation transitions, theme
  persistence, wad lifecycle); the Playwright E2E smoke (#19) exercises the
  shell at desktop **and** mobile viewports.

### Consequences

- Good, because map selection, section navigation, and the 2D/3D mode live in
  one coherent model (`nav` store) instead of per-tab sub-navigations.
- Good, because the large collections get purpose-built, virtualized browsers
  with search where it matters, and the tree stays scannable.
- Good, because mobile is a designed layout (bottom nav, push navigation,
  touch gestures) rather than a squeezed desktop.
- Good, because tokened theming makes light/dark symmetrical and keeps
  components color-free.
- Good, because the 3D keep-alive rule protects the expensive `wgpu`
  initialization and camera pose across navigation, per ADR-0002's lifecycle.
- Bad, because a sidebar-plus-bottom-nav shell, push navigation, and
  virtualized browsers are more up-front UI engineering than the tabbed POC
  successor would have been.
- Bad, because full mobile capability taxes every future view (touch gestures,
  reflow, target sizes) — including the phase-3 viewport's touch controls.
- Neutral, because no URL router means no deep links or back-button
  integration; acceptable while the WAD cannot travel with the URL.

## Pros and cons of the options

### 1 — Simple tabbed viewer

- Good, because it is the fastest to build and matches the ADR-0002 sketch.
- Bad, because map/texture selection needs per-tab sub-navigation (duplicated
  selectors), data-dense browsers fight the single flat pane, and a top tab bar
  degrades poorly to phones.

### 2 — Sidebar shell (chosen)

- Good, because navigation scales by collection size (bounded lists in the
  tree, browsers in-view), and the shell maps cleanly onto the mobile
  bottom-nav idiom.
- Bad, because it is more layout engineering than tabs.

### 3 — Full editor workspace

- Good, because it would rehearse the eventual editor's UX.
- Bad, because ADR-0002 already declares the shell throwaway — dockable-panel
  machinery for an app that edits nothing is speculative weight, and it is the
  hardest of the three to make mobile-capable.

## More information

- Builds on [ADR-0001](0001-consume-crustywad-via-pinned-wasm.md) (client-side,
  privacy-preserving WASM consumer) and
  [ADR-0002](0002-hybrid-portable-core-svelte-shell.md) (hybrid core/shell
  split, wasm↔JS boundary rule, view sketch this ADR replaces).
- Gates phase 1 (2D map) under epic #7; the Playwright smoke (#19) validates
  the shell across viewports.
- **Revisit if:** shareable or restorable view state ever matters (add hash
  routing); the viewer grows editing features (workspace layout becomes
  relevant); or the lump browser needs a hex/preview pane (scope it then).
