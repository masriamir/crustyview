# crustyview
set shell := ["bash", "-uc"]

# Build the workspace
build:
    cargo build --workspace

# Run tests (the WAD sweep skips unless CRUSTYVIEW_WAD_DIR is set)
test:
    cargo test --workspace --all-features

# Lint: fmt check + clippy (native and wasm)
lint:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy -p crustyview-web --target wasm32-unknown-unknown -- -D warnings

# Auto-format
fmt:
    cargo fmt --all

# Full local CI: mirrors the GitHub CI jobs (native + wasm)
ci:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy -p crustyview-web --target wasm32-unknown-unknown -- -D warnings
    cargo test --workspace --all-features
    cargo build -p crustyview-web --target wasm32-unknown-unknown
    cargo deny check

# Build the browser wasm bundle into the Svelte app (web/src/wasm)
web-wasm:
    cd crates/crustyview-web && wasm-pack build --target web --out-dir ../../web/src/wasm

# Dev server for the Svelte app (builds wasm first; assumes `cd web && npm install` was run once)
dev: web-wasm
    cd web && npm run dev

# Production build of the Svelte app (wasm + vite)
build-web: web-wasm
    cd web && npm ci && npm run build

# Native sweep over a local WAD directory (absolute or relative): just sweep path
sweep dir:
    CRUSTYVIEW_WAD_DIR="$(cd "{{dir}}" && pwd)" cargo test -p crustyview-core --test wad_sweep -- --nocapture

# Headless wasm sweep (drives WadDocument): just sweep-wasm path
sweep-wasm dir:
    abs="$(cd "{{dir}}" && pwd)" && cd crates/crustyview-web && wasm-pack build --target nodejs --out-dir web/pkg-node && node ../../scripts/wasm-sweep.cjs "$abs"

# Fetch Freedoom (GPL) WADs into a directory
fetch-freedoom dir=".freedoom" version="0.13.0":
    ./scripts/fetch-freedoom.sh "{{dir}}" "{{version}}"
