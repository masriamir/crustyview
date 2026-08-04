# CLAUDE.md — crustyview

Web-based Doom WAD reader/viewer built on crustywad (separate repo, pinned dependency).

## Dependency rule (load-bearing)
- Depend on a **pinned crustywad release** (`crustywad = "0.9"`). Do not path-depend on a local checkout.
- API friction / bugs → file an **issue on crustywad**, fix on its `main`, bump here on release.
- Urgent fixes only: uncomment the `[patch.crates-io]` git-main override in the root `Cargo.toml`.

## Layout
- `crates/crustyview/src/summary.rs` — native-testable summarization.
- `crates/crustyview/src/probe.rs`   — native-testable map/texture probes.
- `crates/crustyview/src/wasm.rs`     — wasm-bindgen glue (wasm32-only).
- `crates/crustyview/web/`            — minimal HTML/JS host page.

## Workflow
- Branch `<type>/<slug>`; Conventional Commits (lefthook enforces both).
- `just lint` / `just test` before pushing; PRs into `main`, Copilot review + green checks.

## Out of scope (bootstrap)
- UI-framework choice (egui/bevy vs TS+wasm) — decided in a post-spike design.
- Renderer / 3D viewport, full stats dashboard, publishing.
