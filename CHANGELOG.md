# Changelog

All notable changes to crustyview are documented here. Versions follow the
policy in `docs/adr/0004-versioning-and-release-policy.md`.

## [0.2.0] - 2026-08-16

### Bug Fixes

- Correct navigation and keyboard reach during a WAD load (#142)
- Stop a map switch announcing the grid's drawable state (#143)

### Documentation

- Add README badges that read their values from the repo (#122)
- Correct the Copilot identity table and its polling guidance (#150)
- Record why the tile budget is a memory cap and a clipped blit is cheap (#167)
- Record web-browser-test and analyze as required checks (#171)
- Record the Dependabot merge procedure and its four traps (#173)

### Features

- Draw the visible subset of the grid when zoomed out (#128)
- Expose the 2D grid's state to screen readers (#130)
- Explain what the shell and map controls do, and keep empty filters reachable (#138)
- Set the header wordmark in a DOS-era pixel font (#141)
- Classify teleport sources by format and link them to their destinations (#147)
- Give co-op and deathmatch starts their own chips and arrow markers (#151)
- Cap the teleport link arcs drawn and give them their own toggle (#165)

### Performance

- Speed up opening a WAD and stop the main-view flash (#126)
- Cull off-screen geometry from the 2D map (#155)
- Blit a cached bitmap instead of redrawing the 2D map on every pan (#160)
- Cull teleport links by endpoint proximity instead of chord crossing (#163)

### Testing

- Add a browser test tier that catches Svelte lifecycle bugs (#139)
- Load app.css in the browser tier so themed tokens resolve (#170)
## [0.1.2] - 2026-08-11

### Documentation

- Record the ruleset decisions and correct ADR-0004's branch-protection claim (#114)
- Record what coverage cannot measure, and that the Codecov token is optional (#118)
- Add CONTRIBUTING.md and require the lefthook install step (#119)
## [0.1.1] - 2026-08-10

### Bug Fixes

- Create the release tag annotated so --follow-tags pushes it (#91)
- Render a breaking-change marker in the changelog (#93)

### Documentation

- Record the squash-merge changelog contract in ADR-0004 (#94)
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
