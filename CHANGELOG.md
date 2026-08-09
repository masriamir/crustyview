# Changelog

All notable changes to crustyview are documented here. Versions follow the
policy in `docs/adr/0004-versioning-and-release-policy.md`.

## [0.1.0] - 2026-08-09

### Bug Fixes

- Sanitize the WadDocument.load error surface for truncated input (#28)
- Rethink the 2D map canvas accessibility surface (#41)
- Render Eviternity's oversized maps by skipping the lumps the viewer never reads (#82)

### Documentation

- Add ADR-0002 hybrid portable-core + Svelte-shell architecture (#6)
- Adopt project-tracking conventions (CLAUDE.md + ADR headers) (#14)
- Add ADR-0003 viewer UI/UX architecture (sidebar shell, navigation, theming) (#20)
- Set ADR-0002 status to Accepted (#22)
- Drop the wasm32-only WadDocument intra-doc link (#32)

### Features

- WASM go/no-go spike (#4)
- Three-crate split + WadDocument handle (phase 0a, part of #15) (#16)
- Svelte + Vite shell over WadDocument (phase 0b) (#17)
- Restructure the app into the ADR-0003 sidebar shell (#26)
- 2D top-down map view — map2d query + canvas automap (#37)
- Thing category filtering and colors on the 2D map (#38)
- Teleports category for the 2D map thing filter (#42)
- Teleport source lines on the 2D map (map2d linedef specials) (#68)
- Secret and damaging sector boundary overlays on the 2D map (sector specials) (#71)
- Player start visibility independent of the Things toggle (#73)
- Adjustable 2D map grid size with bracket keys (#75)
- Surface the real map2d assembly error (#78)
- Per-map lump-count stats in the status bar (#80)
- Show the build version and git sha in the status bar (#88)

### Testing

- Playwright E2E smoke at desktop and mobile viewports (#27)
