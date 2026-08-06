# crustyview

A web-based Doom WAD reader/viewer built on [crustywad](https://github.com/masriamir/crustywad).

Consumes a pinned crustywad release. API friction found here is filed as issues on
crustywad and fixed there; crustyview bumps the dependency when a release lands.

## Crates

- `crustyview-core` — native-portable WAD summarization/probing (no web deps).
- `crustyview-web` — the wasm-bindgen `WadDocument` shim for the browser.
- `crustyview-native` — a portability-proving skeleton binary.

The browser app lives in top-level `web/` (Svelte + Vite + TypeScript); run it with `just dev`.

Status: bootstrap + WASM go/no-go spike.
