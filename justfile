# crustyview
set shell := ["bash", "-uc"]

# One-time setup for a fresh clone: wasm target, web deps, and git hooks
#
# The last step is the reason this recipe exists. `lefthook.yml` is version-controlled
# but `.git/hooks/` is not, so a fresh clone has NO hooks until `lefthook install` runs
# — and a missing hook is indistinguishable from a passing one. That gap went unnoticed
# in this repo and in crustywad until 2026-08-10 (#111). So this recipe does not just
# run the steps, it ASSERTS the hooks exist afterwards and fails if they do not.
#
# It cannot bootstrap `just` (you are already running it) or `lefthook` (external
# install), so missing prerequisites stop it with the command to fix them rather than
# letting it continue quietly. Every step is idempotent — re-run it any time.
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    missing=0
    for tool in cargo rustup npm lefthook; do
      if ! command -v "$tool" >/dev/null 2>&1; then
        echo "missing: $tool"
        case "$tool" in
          cargo|rustup) echo "  install: https://rustup.rs" ;;
          npm)          echo "  install: https://nodejs.org (v22+)" ;;
          lefthook)     echo "  install: brew install lefthook" ;;
        esac
        missing=1
      fi
    done
    [ "$missing" -eq 0 ] || { echo "error: install the tools above, then re-run 'just setup'" >&2; exit 1; }

    echo "==> rust wasm target"
    rustup target add wasm32-unknown-unknown
    echo "==> web dependencies"
    # `ci`, not `install`: matches what CI runs and never rewrites package-lock.json.
    (cd web && npm ci)
    echo "==> git hooks"
    lefthook install

    # The assertion, not a formality: `lefthook install` reporting success is not the
    # same as the hooks being on disk, and every gate below depends on them being there.
    echo "==> verifying hooks"
    for hook in commit-msg pre-commit pre-push; do
      if [ ! -f ".git/hooks/$hook" ]; then
        echo "error: .git/hooks/$hook is missing after 'lefthook install'" >&2
        echo "  local gates (commit message, fmt/clippy, branch name) would silently do nothing" >&2
        exit 1
      fi
      echo "    ok  .git/hooks/$hook"
    done
    echo "setup complete."

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
