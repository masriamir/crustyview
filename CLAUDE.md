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

## Testing
- `crates/crustyview/tests/wad_sweep.rs` sweeps a local WAD collection, gated by
  `CRUSTYVIEW_WAD_DIR` (must be an **absolute** path — cargo runs tests with CWD
  set to the package root, so a relative path never resolves). It skips (passes)
  when the variable is unset, since commercial IWADs are never committed.
- `just sweep dir=/abs/path` runs the native sweep; `just sweep-wasm dir=/abs/path`
  runs the headless wasm sweep, driving the real `analyze`/`first_texture_rgba`
  wasm exports via `scripts/wasm-sweep.cjs` (builds the nodejs bundle first).
- `just fetch-freedoom` fetches the GPL Freedoom WADs for local use.
- CI runs the sweep automatically (`sweep-freedoom` job) against fetched Freedoom;
  commercial IWADs stay local-only.

## Out of scope (bootstrap)
- UI-framework choice (egui/bevy vs TS+wasm) — decided in a post-spike design.
- Renderer / 3D viewport, full stats dashboard, publishing.
