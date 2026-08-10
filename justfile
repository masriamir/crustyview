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
    cargo clippy -p crustyview-web --target wasm32-unknown-unknown --all-targets --all-features -- -D warnings

# Auto-format
fmt:
    cargo fmt --all

# Fast local subset of the GitHub CI jobs (native + wasm). NOT a mirror: it skips
# wasm-test, web-build, coverage, sweep-freedoom and web-e2e, so green here does not
# guarantee green in CI. Check `gh pr checks` before calling a PR ready.
ci:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy -p crustyview-web --target wasm32-unknown-unknown --all-targets --all-features -- -D warnings
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

# Cut a release: bump from Conventional Commits, write CHANGELOG.md, commit, tag.
# `just release --dry-run` previews without writing.
release *args:
    ./scripts/release.sh {{args}}

# Playwright E2E smoke (fixtures: `just fetch-freedoom` once; browser: `just e2e-install` once)
e2e: build-web
    cd web && npx playwright test

# One-time: install the Playwright Chromium browser
e2e-install:
    cd web && npx playwright install chromium
