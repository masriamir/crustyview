# Copilot instructions — crustyview

Web-based Doom WAD reader/viewer built on crustywad (pinned crates.io dependency). The full conventions to review against live in [`AGENTS.md`](../AGENTS.md), which you also read.

- Rust 2024, no MSRV pin. `clippy::all` + `pedantic` are warnings; CI treats warnings as errors.
- Prefer `T::try_from(..)` over `as` casts to stay clean under `clippy::pedantic`.
- WAD-consuming logic is native-testable (`summary`, `probe`); wasm-bindgen glue is wasm32-only.
- Do not add publishing machinery (release-plz, dist, crates.io). This crate is `publish = false`.
- "Freedoom" is the correct spelling; flag "FreeDoom" as a false positive.
