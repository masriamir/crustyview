# CLAUDE.md — crustyview

Web-based Doom WAD reader/viewer built on crustywad (separate repo, pinned dependency).

## Dependency rule (load-bearing)
- Depend on a **pinned crustywad release** (`crustywad = "0.9"`). Do not path-depend on a local checkout.
- API friction / bugs → file an **issue on crustywad**, fix on its `main`, bump here on release.
- When the crustywad pin bumps, mirror its `rust-version` in `[workspace.package]` — CI's
  `MSRV matches crustywad` step (in the `clippy` job) fails on drift.
- Urgent fixes only: uncomment the `[patch.crates-io]` git-main override in the root `Cargo.toml`.

## Layout
- `crates/crustyview-core/src/{summary,probe,error,map2d}.rs` — native-testable summarization, probes, load-error messages, and 2D map flattening (no web deps).
- `crates/crustyview-web/src/wad_document.rs` — the `WadDocument` wasm-bindgen handle (wasm32-only); `src/lib.rs` re-exports it.
- `crates/crustyview-native/src/main.rs` — the portability-proving skeleton binary.
- `web/` — the top-level Svelte + Vite + TypeScript browser host app (`just dev`); it consumes
  `crustyview-web`'s wasm-bindgen `--target web` output (built into `web/src/wasm`, gitignored).

## Workflow
- Branch `<type>/<slug>`; Conventional Commits (lefthook enforces both).
- `just lint` / `just test` before pushing; PRs into `main`, Copilot review + green checks.
- Every change is tracked by a GitHub **issue** on the board (see Project tracking); branch
  by issue number where one exists (`<type>/<###>-<slug>`).
- **PRs squash-merge, so the PR title _is_ the changelog entry and the version bump** — it
  becomes the only commit on `main`, and git-cliff parses it, never the branch's commits.
  Write it as a real Conventional Commit describing the shipped outcome: the type decides
  inclusion (`chore:`/`ci:`/`build:` are skipped) and the bump, so a `chore:`-titled feature
  is silently dropped from `CHANGELOG.md` and skips the minor. Declare breaking changes with
  `!` in the **title** — the squash body is `BLANK` by policy and carries nothing, so a
  `BREAKING CHANGE:` footer written on a branch commit is discarded at merge (ADR-0004,
  policy item 5). Never `gh pr create --fill`: it derives the title from the branch name.
- The title's **form** is checked by CI's `pr-title` job, which shares one regex with
  lefthook's `commit-msg` hook — `scripts/check-conventional-subject.py` is the single source
  of truth for both, so the gate on the PR title and the gate on branch commits cannot drift
  apart. It cannot be a *required* check while the repo is private+free, so treat a red
  `pr-title` as blocking by process. It validates form only: whether the chosen **type** is the
  right one for the change remains a human judgement no parser can make.
- **Releases are cut locally**, never in CI: `just release` (`--dry-run` to preview) bumps
  `[workspace.package].version` from Conventional Commits, regenerates `CHANGELOG.md`, commits,
  and tags `v<version>`; push with `git push --follow-tags`. `chore:`/`ci:`/`build:` are
  `skip = true` in `cliff.toml`, so a run with only those refuses rather than re-tagging.
  release-plz is deliberately **not** used — see ADR-0004.

## Project tracking

Work is tracked on the shared **[Crustywad GitHub Project #5](https://github.com/users/masriamir/projects/5)** — crustyview issues live on the same board as crustywad. **Every change** — feature, bug, chore, docs, spike — gets a GitHub issue, added to the board with three planning fields:

- **Status:** `Backlog` → `Ready` → `In progress` → `In review` → `Done`. Most transitions are agent-driven (below); `Done` is board-automated on merge/close.
- **Horizon:** `Now` / `Next` / `Later` — planning intent for unmilestoned items.
- **Milestone** (per-repo, scope-named, never version numbers): `Viewer shell`, `2D map`, `3D viewport`. Record shipped versions in the description at closeout. GitHub never auto-closes milestones — when a milestone's issues are all closed, propose closing it rather than closing it unilaterally.

**Epics** (`epic` label) use native GitHub sub-issues for progress rollup: **#7 viewer shell & UI**, **#8 3D renderer**. Attach each new feature issue as a sub-issue of its epic. An epic moves to `In progress` when its first sub-issue starts and to `Done` (board-automated) only when all its sub-issues close; set the epic's aggregate Status by hand, since GitHub doesn't roll Status up.

**Labels** mirror crustywad's general-purpose taxonomy (`epic`, `spike`, `testing`, `chore`, `maintenance`, `security`, `performance`, `release`, plus triage labels) with three crustyview domain labels: `renderer` (wgpu/3D viewport), `web-ui` (Svelte/TS shell),
and `accessibility` (a11y work across the shell and map views).

### Issue status transitions (agent-driven)

Move the board yourself and **announce each change** (don't ask first) — board edits are internal and reversible:

| Transition | Trigger |
|---|---|
| `Backlog → Ready` | the user says they want to start an issue |
| `Ready → In progress` | you begin planning it — before any branch or code |
| `In progress → In review` | the PR opens |
| `In review → Done` | PR merges/closes — **board-automated**, don't set it by hand |

The `gh` recipes (project id, Status/Horizon field + option IDs) are shared with crustywad — Project #5's fields are project-level, identical for crustyview items.

## Decisions
- Architectural / hard-to-reverse decisions are recorded as ADRs in
  [`docs/adr/`](../docs/adr/) — lightweight (structure mirrors crustywad, without the
  library-publishing ceremony). See [`docs/adr/README.md`](../docs/adr/README.md) for the
  process; [ADR-0001](../docs/adr/0001-consume-crustywad-via-pinned-wasm.md) records the
  pinned-release WASM-consumer decision, and
  [ADR-0002](../docs/adr/0002-hybrid-portable-core-svelte-shell.md) records the hybrid UI
  architecture — a portable Rust/`wgpu` core (`crustyview-core`) behind a Svelte + TypeScript
  shell (`crustyview-web`), with `crustyview-native` proving portability; wgpu = 3D only,
  everything 2D/DOM in TypeScript.
  [ADR-0003](../docs/adr/0003-viewer-ui-ux-sidebar-shell.md) records the viewer UI/UX —
  a sidebar shell (header · tree · main view · status bar) with state-driven navigation
  (no URL router), domain stores (`wad`/`nav`/`theme`), tokened light/dark theming, and a
  first-class compact layout (bottom nav + push navigation below 48rem).
  [ADR-0004](../docs/adr/0004-versioning-and-release-policy.md) records versioning and
  releases — one product version in `[workspace.package]` inherited by all three crates,
  one tag `v<version>`, one root `CHANGELOG.md`, cut locally by `just release` via git-cliff.

## Testing
- `crates/crustyview-core/tests/wad_sweep.rs` sweeps a local WAD collection, gated by
  `CRUSTYVIEW_WAD_DIR` (prefer an **absolute** path — cargo runs tests with CWD
  set to the package root, so a relative value resolves against that, rarely what
  you intend; the `just sweep` recipe absolutizes it for you). It skips (passes)
  when the variable is unset, since commercial IWADs are never committed.
- `just sweep /abs/path` runs the native sweep (`cargo test -p crustyview-core --test
  wad_sweep`); `just sweep-wasm /abs/path` runs the headless wasm sweep, driving the
  real `WadDocument` wasm exports via `scripts/wasm-sweep.cjs` (builds the
  `crustyview-web` nodejs bundle first with `--target nodejs`).
- `just fetch-freedoom` fetches the GPL Freedoom WADs for local use.
- CI runs the sweep automatically (`sweep-freedoom` job) against fetched Freedoom;
  commercial IWADs stay local-only.
- **E2E smoke:** Playwright specs in `web/e2e/` drive the built app in headless Chromium at
  desktop and mobile viewports (`just e2e`; one-time `just e2e-install` + `just fetch-freedoom`).
  The fixture-driven specs skip when the `.freedoom/` fixtures are absent. CI runs them in the `web-e2e` job
  (fetches Freedoom itself); the job is a smoke signal, not a merge gate.
- **Coverage:** the `coverage` job uploads `lcov.info` (`cargo llvm-cov --workspace`) to Codecov
  with `fail_ci_if_error: true` and no `continue-on-error` — a rejected upload turns CI **red**
  rather than passing silently. Both are load-bearing: the action exits 0 on upload failure by
  default, so removing `continue-on-error` alone would not surface it. Reading the results:
  - `codecov/patch` (80% of the diff, per `codecov.yml`) arrives on a PR as a **check run**
    (so `gh pr checks` sees it) and on `main` as a **commit status**
    (`gh api repos/masriamir/crustyview/commits/<sha>/status`). It counts as a CI check.
  - `codecov/project` is configured (`target: auto`, `threshold: 1%`) but has never been seen
    posting on this repo — don't block on it.
  - The `codecov[bot]` **PR comment** carries the missing-lines table the review loop gates on,
    but `require_changes: true` suppresses it when coverage is unchanged: a PR touching no Rust
    correctly gets **no comment**. Only a missing comment on a Rust-touching PR is a red flag.

## Copilot review loop
- Every non-draft PR is auto-requested for **Copilot** review by
  `.github/workflows/copilot-review.yml`. This exists because a private repo on a free
  personal plan **cannot** use rulesets/branch protection to request Copilot (or enforce
  required checks) — the workflow substitutes for that. Retire it when the repo goes public
  and a ruleset can request Copilot automatically.
- Copilot has **three intentionally-different identifiers** — mixing them up breaks scripts:
  - `copilot-pull-request-reviewer` — the review **author** login (match on this when polling `reviews`).
  - `Copilot` — what `requested_reviewers` returns as `.users[].login` (the display login; the
    workflow's idempotency check greps for this).
  - `copilot-pull-request-reviewer[bot]` — the REST **request** slug; the `[bot]` suffix is required
    *only* by the reviewer-request API call below.
- Manual (re-)request: `gh api --method POST repos/masriamir/crustyview/pulls/<N>/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`.
- Work the comments with the personal `resolving-bot-pr-reviews` skill across as many rounds
  as needed. CI command: `just ci` (mirrors the crustyview CI checks). Owner/repo:
  `masriamir/crustyview`.
- A PR is ready for human review only when **all** Copilot threads are resolved **and** all
  CI checks pass (`gh pr checks`). Branch protection can't enforce this while private+free,
  so it is a process discipline: never merge over an unresolved thread or a red check.

## Not yet built (tracked on the board)
- The virtualized texture and lump browsers (need the `textureRgba(name)` contract change
  and a lump-directory query) and the wgpu 3D viewport — decided (ADR-0002/ADR-0003), staged
  across epics #7/#8 and milestones `Viewer shell` / `2D map` / `3D viewport`.
- Publishing / hosted deployment.
