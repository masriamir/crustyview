# crustyview

[![CI](https://img.shields.io/github/actions/workflow/status/masriamir/crustyview/ci.yml?branch=main&label=CI)](https://github.com/masriamir/crustyview/actions/workflows/ci.yml)
[![core coverage](https://img.shields.io/codecov/c/github/masriamir/crustyview?label=core%20coverage)](https://app.codecov.io/gh/masriamir/crustyview)
[![version](https://img.shields.io/github/v/tag/masriamir/crustyview?label=version&color=green)](https://github.com/masriamir/crustyview/releases)
[![MSRV](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmasriamir%2Fcrustyview%2Fmain%2FCargo.toml&query=%24.workspace.package.rust-version&label=MSRV&color=blue)](Cargo.toml)
[![crustywad](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmasriamir%2Fcrustyview%2Fmain%2Fcrates%2Fcrustyview-core%2FCargo.toml&query=%24.dependencies.crustywad&label=crustywad&color=orange)](https://github.com/masriamir/crustywad)
[![license](https://img.shields.io/badge/dynamic/toml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmasriamir%2Fcrustyview%2Fmain%2FCargo.toml&query=%24.workspace.package.license&label=license&color=blue)](#license)

A web-based Doom WAD reader/viewer built on [crustywad](https://github.com/masriamir/crustywad).

Consumes a pinned crustywad release. API friction found here is filed as issues on
crustywad and fixed there; crustyview bumps the dependency when a release lands.

## Crates

- `crustyview-core` — native-portable WAD summarization/probing (no web deps).
- `crustyview-web` — the wasm-bindgen `WadDocument` shim for the browser.
- `crustyview-native` — a portability-proving skeleton binary.

The browser app lives in top-level `web/` (Svelte + Vite + TypeScript). Install its
dependencies once via `just setup`, then run `just dev` (which builds the wasm
and starts the Vite dev server).

## Decisions

Architectural decisions are recorded as ADRs in [`docs/adr/`](docs/adr/); see
the [index](docs/adr/README.md#index) for the full list.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch and commit conventions, and how a PR
gets merged. After cloning, run **`just setup`** — it installs the wasm target, the web
dependencies and the git hooks, then verifies the hooks landed. Without them, every local gate
silently does nothing.

## License

Dual-licensed under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option
(`license = "MIT OR Apache-2.0"`). GitHub's sidebar reports this as "NOASSERTION" because its
detector does not resolve dual licenses — the crate manifests carry the authoritative
declaration.

---

Status: bootstrap + WASM go/no-go spike.
