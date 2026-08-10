# Contributing to crustyview

crustyview is a web-based Doom WAD reader/viewer: a portable Rust core compiled to WebAssembly,
behind a Svelte + TypeScript shell. Issues and pull requests are welcome.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security
issue, use [private vulnerability reporting](https://github.com/masriamir/crustyview/security/advisories/new)
rather than a public issue — see [SECURITY.md](SECURITY.md).

## Setup

You need:

| Tool | Used by | Install |
|---|---|---|
| `git` | cloning, the hooks, `just setup` | <https://git-scm.com/downloads> |
| Rust (stable; MSRV pinned in `Cargo.toml`) | everything | <https://rustup.rs> |
| Node.js **22.20+** | the Svelte app | <https://nodejs.org> |
| `just` | every recipe below | <https://github.com/casey/just> |
| `lefthook` | the git hooks | <https://github.com/evilmartians/lefthook#install> |
| `wasm-pack` | `just dev`, `just web-wasm`, `just sweep-wasm` | `cargo install wasm-pack` |
| `cargo-deny` | `just ci` | `cargo install cargo-deny` |
| `python3` | the `commit-msg` hook | usually preinstalled |

`just setup` checks for all of them and stops with the install command if any is missing, so you
do not have to audit this list by hand.

**22.20, not 22** — `web/package-lock.json` pins a transitive dependency requiring
`^22.20 || ^24.12 || >=25`, so `npm ci` fails on 22.0–22.19 despite those satisfying "22+".

```sh
git clone https://github.com/masriamir/crustyview
cd crustyview
just setup
```

`just setup` adds the wasm target, installs the web dependencies with `npm ci` (matching CI, and
never rewriting the lockfile), installs the git hooks, and then **verifies the hooks are actually
on disk**. It is idempotent — re-run it whenever you like. If a prerequisite is missing it stops
and names the install command rather than continuing quietly.

**Why the hook step gets its own verification.** The repo ships a `lefthook.yml`, but git hooks
live in git's hooks directory, which is not version-controlled — so a fresh clone has no hooks
until `lefthook install` runs. Skip it and every local gate silently does nothing: commit messages go
unchecked, `cargo fmt`/`clippy` never run before a commit, branch names are never validated.
Nothing warns you; things simply pass. That is not hypothetical — it went unnoticed in this repo
and in its sibling until 2026-08-10. `just setup` therefore asserts the hooks exist and fails if
they do not, because `lefthook install` reporting success is not the same as the hooks being
there.

If you prefer to run the steps yourself, the equivalent is:

```sh
rustup target add wasm32-unknown-unknown
cd web && npm ci && cd ..
lefthook install
ls "$(git rev-parse --git-path hooks)"   # expect: commit-msg, pre-commit, pre-push
```

Ask git for the hooks path rather than assuming `.git/hooks`: inside a worktree (or some
submodule layouts) `.git` is a *file* pointing elsewhere, so `.git/hooks` does not exist even
though the hooks are installed and firing.

## Everyday commands

| Command | What it does |
|---|---|
| `just setup` | One-time (idempotent) clone setup; verifies the git hooks are installed |
| `just dev` | Build the wasm and start the Vite dev server |
| `just lint` | `cargo fmt --check` + clippy, **native and wasm targets** |
| `just test` | `cargo test --workspace --all-features` |
| `just ci` | Fast local subset of CI — see the caveat below |
| `just e2e` | Playwright smoke tests (one-time: `just e2e-install`, `just fetch-freedoom`) |

`just ci` is a **subset**, not a mirror. It does not run `wasm-test`, `web-build`, `coverage`,
`sweep-freedoom`, or `web-e2e`. A green `just ci` is necessary but not sufficient — `gh pr checks`
is the source of truth.

## Branches

`<type>/<slug>`, with the issue number when one exists: `feature/42-mmap`, `chore/103-audit`.

Valid types are exactly **`feature`, `bugfix`, `hotfix`, `docs`, `chore`** — enforced by
lefthook's `pre-push` hook. Note this list is narrower than the Conventional Commit types used in
messages: `ci:` is a perfectly good commit type but **`ci/` is not a valid branch prefix**. Use
`chore/` for CI work.

## Commits and pull request titles

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by
lefthook's `commit-msg` hook via `scripts/check-conventional-subject.py`.

**The PR title matters more than your commit messages.** Pull requests are squash-merged, so the
PR title becomes the only commit on `main` — it is what `git-cliff` parses for the changelog and
the version bump. Branch commits are discarded.

Consequences worth knowing before you pick a title:

- The **type decides inclusion and bump**. `chore:`, `ci:` and `build:` are skipped by
  `cliff.toml`, so a user-visible change titled `chore:` vanishes from `CHANGELOG.md` *and* skips
  the version bump.
- Declare breaking changes with **`!` in the title** (`feat!: …`). The squash body is blank by
  policy, so a `BREAKING CHANGE:` footer written on a branch commit is discarded at merge.
- CI's `pr-title` job validates the title's **form** and is a required check. A separate `pr-type`
  job warns when a skipped type ships source changes — it can never fail the build; read it and
  decide.

## Opening a pull request

Run `just lint` and `just test` first, then open the PR against `main`.

Merging requires every required status check green and every review thread resolved — both
enforced by the `Main Branch` ruleset, not by convention. GitHub Copilot reviews each PR
automatically, and pushing new commits triggers a fresh review.

Two things the automation will not tell you:

- **Coverage does not measure `crustyview-web`.** `cargo llvm-cov` runs on the host target, where
  that crate is `#[cfg(target_arch = "wasm32")]`-gated to nothing. Changes to the browser API need
  a `#[wasm_bindgen_test]` in `crates/crustyview-web/tests/web.rs`, because no coverage number
  will notice its absence.
- **Third-party actions are pinned to commit SHAs** and the repo rejects unpinned ones. If you
  edit a workflow, resolve the SHA (`gh api repos/<owner>/<repo>/commits/<ref> --jq .sha`) and
  keep the readable ref in a trailing comment.

## Architecture

Decisions are recorded as ADRs in [`docs/adr/`](docs/adr/); start with the
[index](docs/adr/README.md#index). The short version: `wgpu` is for 3D only, and everything 2D or
DOM-shaped stays in TypeScript ([ADR-0002](docs/adr/0002-hybrid-portable-core-svelte-shell.md)).
