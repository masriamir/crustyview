# ADR-0001: Consume crustywad as a pinned-release Rust→WASM dependency

- **Status:** Accepted
- **Date:** 2026-08-05
- **Deciders:** Amir Masri (with collaborative design)
- **Tracking issue / PR:** #10 · PR #4 (`feature/wasm-spike`)

## Context and problem statement

`crustyview` is a browser-based Doom WAD reader/viewer, and a stepping stone
toward a future native (Windows/Linux/macOS) editor. It must read WADs —
geometry, textures, palettes — which `crustywad` already does. How should
`crustyview` build on `crustywad`, and is that read path even viable inside a
browser?

## Decision drivers

- **Reuse toward the native editor.** Logic written once should carry forward to
  the eventual native app, not be thrown away.
- **Client-side, no server.** WADs should be parsed in the browser and never leave
  the user's machine.
- **Dogfood `crustywad` toward 1.0.** A real external consumer is the best pressure
  on the library's public API.
- **Stand on a stable base**, not a moving target.

## Considered options

1. **Rust → WASM consumer of a pinned `crustywad` release** (separate repo,
   `crustywad` as an ordinary Cargo dependency).
2. **Python (PyO3) bindings over `crustywad` + a server backend**, browser talks
   to the server.
3. **In-workspace crate / long-lived branch** instead of a separate repo consuming
   a released version.

## Decision outcome

Chosen option: **1 — a separate-repo Rust→WASM consumer of a pinned release.**
Concretely: `crustywad = "0.9"` from crates.io (currently 0.9.3), **default
features with `mmap` off** (WASM cannot memory-map); a thin, `wasm32`-only
`wasm-bindgen` glue layer (`analyze`, `first_texture_rgba`) over
native-testable logic (`summary`, `probe`); **best-effort reads** (a map- or
texture-probe error becomes `null`, never aborting the load); and API friction
filed as issues on `crustywad`, fixed there, picked up here when a release lands.

A go/no-go spike **validated this end to end (GO):** `crustywad` parses, assembles
maps, and composites palette-applied textures under `wasm32`, verified headlessly
(Node) and in the browser across the full retail IWAD collection and the
GL/XNOD/ZNOD extended-node variants. Both API assumptions the spike relied on
(`Wad::detect_game`, `crustywad::map::Map`) matched the released 0.9.3 surface
exactly, so the spike filed **zero** friction issues.

### Consequences

- Good, because the parse→geometry→texture logic is reusable in the native editor,
  and the app is a static, server-less, privacy-preserving site.
- Good, because pinning a real consumer to `crustywad`'s public API is direct
  progress toward its v1.0 stabilization.
- Bad, because fixes reach the viewer only at `crustywad` release boundaries (a
  `[patch.crates-io]` git-`main` override is the documented escape hatch for
  urgent cases).
- Neutral, because the **UI-framework choice remains open** — (A) all-Rust WASM
  (egui/bevy) vs (D) a Rust-WASM core with a TypeScript UI — to be settled in a
  later ADR. Python bindings were set aside for the viewer but remain a plausible
  *separate* future output for corpus analytics.

## Pros and cons of the options

### 1 — Rust → WASM consumer of a pinned release

- Good, because it reuses toward the native editor, needs no server, and the pinned
  dependency is the honest external-consumer relationship that stabilizes the API.
- Bad, because the browser 3D work (the eventual bulk) is a separate effort layered
  on top.

### 2 — Python (PyO3) bindings + server

- Good, because Python is an ergonomic web/back-end ecosystem for request/response
  and data work.
- Bad, because it reuses nothing toward the native editor, forces a server and WAD
  uploads, and doesn't help the browser-side 3D (still JS/WebGPU regardless).

### 3 — In-workspace crate / long-lived branch

- Good, because it avoids a second repository.
- Bad, because a workspace path-dependency tracks `main`, not a release —
  silently reintroducing the coupling this decision avoids — and drags a
  WASM/renderer toolchain through the library's pristine CI.

## More information

- **Living evidence:** the spike's one-off verification table is superseded by the
  repeatable sweep harness — `just sweep <dir>` (native, full local collection),
  `just sweep-wasm <dir>` (drives the real WASM exports), and the automatic
  `sweep-freedoom` CI job. This ADR retires the former `SPIKE.md`.
- **Revisit** the framework question (A vs D) in a dedicated follow-up ADR before
  building the renderer.
