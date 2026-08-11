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

# Finish a release: push the commit + tag, verify both landed, publish the GitHub Release
release-finish:
    #!/usr/bin/env bash
    set -euo pipefail
    # Everything AFTER the review checkpoint, as one idempotent command.
    #
    # `just release` deliberately stops before pushing, because that is the last
    # cheaply reversible moment: until the push, `git reset --hard HEAD~1 && git tag -d
    # <tag>` erases the release completely, while afterwards the release commit sits on
    # `main` behind `non_fast_forward` + `deletion` rules and un-pushing needs an admin
    # bypass. That checkpoint is worth keeping — you read the generated CHANGELOG.md
    # and version before they become permanent (ADR-0004).
    #
    # What is NOT worth keeping is three memorised commands after it. A forgotten one
    # leaves a half-release, and this repo has already shipped one at exactly this
    # seam (v0.1.0 went out untagged — see the annotated-tag comment in release.sh).
    # So the checkpoint stays manual and the ceremony does not.
    # `git describe` exits 128 with "fatal: No names found, cannot describe anything."
    # when nothing is tagged — an opaque way to learn you have not cut a release, and
    # equally what a fresh clone that skipped `--tags` would hit.
    if ! tag="$(git describe --tags --abbrev=0 2>/dev/null)"; then
      echo "error: no tags found, so there is no release to finish" >&2
      echo "  cut one first:        just release" >&2
      echo "  or fetch existing:    git fetch --tags" >&2
      exit 1
    fi
    echo "==> finishing $tag"

    # Guardrails, because everything below this point is outward-facing and hard to
    # undo: a pushed tag and a published GitHub Release. `git describe` returns
    # WHATEVER the nearest tag is, so without these a stray local tag gets shipped to
    # a public repo. Learned the hard way while building this recipe (#86) — a probe
    # tag was pushed and a Release published before these existed.
    #
    # Same pattern release.sh validates, so the two agree on what a release tag is.
    if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "error: '$tag' is not a release tag (want vMAJOR.MINOR.PATCH)" >&2
      echo "  refusing to push or publish it" >&2
      exit 1
    fi
    # An annotated tag is what `--follow-tags` carries; a lightweight one would push
    # the commit and silently leave the tag behind.
    if [ "$(git cat-file -t "$tag" 2>/dev/null)" != "tag" ]; then
      echo "error: $tag is lightweight, not annotated — '--follow-tags' would skip it" >&2
      exit 1
    fi
    # The tag must name the release commit sitting at HEAD. If it does not, something
    # else has moved and this is not the release just cut.
    if [ "$(git rev-parse "$tag^{commit}")" != "$(git rev-parse HEAD)" ]; then
      echo "error: $tag does not point at HEAD — refusing to publish" >&2
      echo "  tag:  $(git rev-parse --short "$tag^{commit}")" >&2
      echo "  HEAD: $(git rev-parse --short HEAD)" >&2
      exit 1
    fi

    # Releases are cut on `main` and pushed there (ADR-0004), so anywhere else this
    # would publish a Release for a commit `main` does not contain.
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if [ "$branch" != "main" ]; then
      echo "error: release-finish must run on main, not '$branch'" >&2
      exit 1
    fi

    # Idempotence keys on BOTH the tag and the commit, not the tag alone. A tag can be
    # on origin while the release commit is not on origin/main — push the tag by hand,
    # or have a push half-fail — and a tag-only check would then skip the push and
    # happily publish a Release for a commit main does not contain.
    git fetch --quiet origin main
    tag_on_origin=false
    commit_on_origin=false
    git ls-remote --tags --exit-code origin "refs/tags/$tag" >/dev/null 2>&1 && tag_on_origin=true
    git merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1 && commit_on_origin=true

    if $tag_on_origin && $commit_on_origin; then
      echo "    commit and tag already on origin"
    else
      echo "==> pushing commit and tag to origin"
      # `origin main` explicitly, never a bare `git push`: the branch's configured push
      # remote is not guaranteed to be origin, and everything verified below asks
      # origin. Pushing one place and verifying another would report a false success.
      #
      # --follow-tags carries ANNOTATED tags only; release.sh creates them with -a
      # precisely so this works. A plain `git push` would land the commit and silently
      # leave the tag behind, exiting 0 either way.
      git push --follow-tags origin main
    fi

    # Verify rather than trust the push's exit code — the failure mode this guards is a
    # push that succeeds while carrying no tag, or landing the tag without the commit.
    echo "==> verifying the release landed on origin"
    git fetch --quiet origin main
    if ! git ls-remote --tags --exit-code origin "refs/tags/$tag" >/dev/null 2>&1; then
      echo "error: $tag is still not on origin after pushing" >&2
      echo "  a lightweight tag would do this — check: git cat-file -t $tag (want 'tag')" >&2
      exit 1
    fi
    if ! git merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1; then
      echo "error: the release commit is not on origin/main after pushing" >&2
      echo "  publishing now would tag a commit main does not contain" >&2
      exit 1
    fi
    echo "    ok  commit is on origin/main"
    echo "    ok  $tag is on origin"

    echo "==> publishing the GitHub Release"
    if gh release view "$tag" >/dev/null 2>&1; then
      echo "    Release $tag already exists — nothing to do."
      echo "$tag is fully released."
      exit 0
    fi

    # `--strip all` drops the changelog header/footer; the leading `## [x.y.z]` heading
    # goes too, since GitHub already titles the Release with the tag.
    #
    # awk, not sed: BSD sed (macOS) rejects `1{/re/d}` without a trailing semicolon
    # while GNU sed accepts it, and this recipe runs on a maintainer's machine —
    # so the portable form is the only one that is actually tested where it runs.
    # An explicit full template, not bare `mktemp` and not `-t`: BSD and GNU disagree
    # on what `-t` means, while a complete path template behaves identically on both.
    notes="$(mktemp "${TMPDIR:-/tmp}/crustyview-relnotes.XXXXXX")"
    trap 'rm -f "$notes"' EXIT
    git-cliff --latest --strip all \
      | awk 'NR==1 && /^## \[/ { next } !started && NF==0 { next } { started=1; print }' > "$notes"
    if [ ! -s "$notes" ]; then
      echo "error: generated release notes are empty for $tag" >&2
      exit 1
    fi

    gh release create "$tag" --title "$tag" --notes-file "$notes" --verify-tag
    echo "Published: $(gh release view "$tag" --json url --jq .url)"

# Playwright E2E smoke (fixtures: `just fetch-freedoom` once; browser: `just e2e-install` once)
e2e: build-web
    cd web && npx playwright test

# One-time: install the Playwright Chromium browser
e2e-install:
    cd web && npx playwright install chromium
