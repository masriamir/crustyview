# crustyview
set shell := ["bash", "-uc"]

# Build the workspace
build:
    cargo build --workspace

# One-time setup for a fresh clone (idempotent): wasm target, web deps, git hooks
#
# Keep this BELOW `build`: bare `just` runs the FIRST recipe in the file, so putting
# setup at the top silently turned the no-argument default into "run installs".
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    # The hook step is why this recipe exists. `lefthook.yml` is version-controlled but
    # `.git/hooks/` is not, so a fresh clone has NO hooks until `lefthook install` runs
    # — and a missing hook is indistinguishable from a passing one. That gap went
    # unnoticed in this repo and in crustywad until 2026-08-10 (#111). So this does not
    # just run the steps, it ASSERTS the hooks exist afterwards and fails if they do not.
    #
    # It cannot bootstrap `just` (you are running it) or `lefthook` (external install),
    # so missing prerequisites stop it with the fix rather than continuing quietly.
    # Everything the documented workflows shell out to, not just what setup itself
    # needs — the point is to fail here rather than at first `just dev` or `just ci`.
    # `wasm-pack` (web-wasm, sweep-wasm), `cargo-deny` (ci) and `python3` (lefthook's
    # commit-msg hook) are easy to miss precisely because a maintainer already has them.
    missing=0
    # `git` belongs here even though you needed it to clone: this recipe shells out to
    # `git rev-parse` for the hooks path, and lefthook itself drives git — so a `git`
    # that is missing from PATH (not merely absent) breaks setup rather than the clone.
    for tool in git cargo rustup npm lefthook wasm-pack cargo-deny python3; do
      if ! command -v "$tool" >/dev/null 2>&1; then
        echo "missing: $tool"
        case "$tool" in
          git)          echo "  install: https://git-scm.com/downloads" ;;
          cargo|rustup) echo "  install: https://rustup.rs" ;;
          # 22.20, not 22: web/package-lock.json pins a transitive dep requiring
          # `^22.20 || ^24.12 || >=25`, so plain "22+" lets `npm ci` fail on 22.0-22.19.
          npm)          echo "  install: https://nodejs.org (v22.20+)" ;;
          # Platform-neutral: this message is what a contributor on any OS sees.
          lefthook)     echo "  install: https://github.com/evilmartians/lefthook#install (macOS: brew install lefthook)" ;;
          wasm-pack)    echo "  install: cargo install wasm-pack" ;;
          cargo-deny)   echo "  install: cargo install cargo-deny" ;;
          python3)      echo "  install: https://www.python.org/downloads/ (usually preinstalled)" ;;
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
    #
    # Ask git where the hooks live rather than assuming `.git/hooks`. In a worktree (and
    # some submodule layouts) `.git` is a FILE pointing elsewhere, so `.git/hooks` does
    # not exist even though the hooks are installed and firing — hard-coding the path
    # makes this check cry wolf in exactly the setups it should support.
    echo "==> verifying hooks"
    hooks_dir="$(git rev-parse --git-path hooks)"
    for hook in commit-msg pre-commit pre-push; do
      if [ ! -f "$hooks_dir/$hook" ]; then
        echo "error: $hooks_dir/$hook is missing after 'lefthook install'" >&2
        echo "  local gates (commit message, fmt/clippy, branch name) would silently do nothing" >&2
        exit 1
      fi
      echo "    ok  $hooks_dir/$hook"
    done
    echo "setup complete."

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

# Fast local SUBSET of CI (not a mirror) — `gh pr checks` is the source of truth
ci:
    # Skips wasm-test, web-build, coverage, sweep-freedoom and web-e2e, so a green
    # run here is necessary but not sufficient. `just --list` shows only the last
    # comment line above a recipe, which is why the detail lives in the body.
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy -p crustyview-web --target wasm32-unknown-unknown --all-targets --all-features -- -D warnings
    cargo test --workspace --all-features
    cargo build -p crustyview-web --target wasm32-unknown-unknown
    cargo deny check

# Build the browser wasm bundle into the Svelte app (web/src/wasm)
web-wasm:
    cd crates/crustyview-web && wasm-pack build --target web --out-dir ../../web/src/wasm

# Dev server for the Svelte app (builds wasm first; run `just setup` once beforehand)
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

# Cut a release: bump from Conventional Commits, write CHANGELOG.md, commit, tag (--dry-run previews)
release *args:
    ./scripts/release.sh {{args}}

# Playwright E2E smoke (fixtures: `just fetch-freedoom` once; browser: `just e2e-install` once)
e2e: build-web
    cd web && npx playwright test

# One-time: install the Playwright Chromium browser
e2e-install:
    cd web && npx playwright install chromium
