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
  apart. It is a **required** check in the `Main Branch` ruleset, so a red `pr-title` blocks the
  merge outright. It validates form only: whether the chosen **type** is the right one for the
  change remains a human judgement no parser can make.
- The **type** gets a heuristic second opinion from CI's `pr-type` job, which warns when a title
  whose type is `skip = true` in `cliff.toml` ships a diff touching `crates/*/src/**`,
  `crates/*/tests/**` or `web/src/**` — the exact shape that vanishes from `CHANGELOG.md` and
  skips the bump. It **never fails a build**, because a real chore can legitimately touch source;
  read the annotation and decide. The skipped types are read out of `cliff.toml`, so the warning
  cannot drift from what git-cliff does.
- **Releases are cut locally**, never in CI: `just release` (`--dry-run` to preview) bumps
  `[workspace.package].version` from Conventional Commits, regenerates `CHANGELOG.md`, commits,
  and tags `v<version>`; push with `git push --follow-tags`. `chore:`/`ci:`/`build:` are
  `skip = true` in `cliff.toml`, so a run with only those refuses rather than re-tagging.
  release-plz is deliberately **not** used — see ADR-0004.
- **Every `uses:` in `.github/workflows/` is pinned to a 40-character commit SHA**, with the
  human-readable ref preserved in a trailing comment
  (`actions/checkout@3d3c42e5… # v7`). A tag or branch ref is mutable, so an unpinned action
  is an unreviewed third party with write access to the CI that gates `main`. Mirrors
  crustywad. Three details that are easy to get wrong:
  - **Branch refs get pinned too**, and say so: `dtolnay/rust-toolchain@4360b525… # stable
    branch pin`. This freezes the *action*, not the Rust toolchain — the action still
    installs whatever `stable` resolves to at run time.
  - **`taiki-e/install-action`'s ref is the tool name**, so its comment must be the tool
    (`# cargo-deny`), not a version. The same action appears at several SHAs, one per tool,
    and the comment is the only thing that says which is which.
  - **Never hand-write a SHA.** Resolve it — `gh api repos/<owner>/<repo>/commits/<ref>
    --jq .sha` — and keep the comment matching the ref you resolved, or the next reader
    cannot tell what the pin was meant to track. Bumps are Dependabot's job
    (`.github/dependabot.yml`, weekly), not something to do by hand while editing a workflow
    for other reasons.

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
- **Coverage:** the `coverage` job uploads `lcov.info` (`cargo llvm-cov --workspace
  --all-features`) to Codecov with `fail_ci_if_error: true` and no `continue-on-error` — a
  rejected upload turns CI **red** rather than passing silently. Both are load-bearing: the
  action exits 0 on upload failure by default, so removing `continue-on-error` alone would not
  surface it.
- **What coverage does NOT measure — read this before trusting the percentage.**
  `cargo llvm-cov` runs on the **host** target, and `crustyview-web` gates its entire body on
  `#[cfg(target_arch = "wasm32")]`, so it compiles to nothing there and has nothing to
  instrument. The report covers **7 files** — six in `crustyview-core` plus
  `crustyview-native/src/main.rs` — and **zero** in `crustyview-web`. That is 119 lines and all
  seven browser-API methods (`load`, `summary`, `map_names`, `map2d`, `map_stats`,
  `texture_meta`, `texture_rgba`) outside the number. The headline percentage means "of what
  llvm-cov could see", not "of the repo". This is the same structural blind spot that let CI's
  clippy pass on unlinted code until #115; here it cannot be fixed the same way, because
  llvm-cov cannot instrument a wasm32 target.
  - **The compensating control is `wasm-test`**, a required check running
    `wasm-pack test --node`. `crates/crustyview-web/tests/web.rs` holds six
    `#[wasm_bindgen_test]`s that exercise all seven methods. The browser API is tested; it is
    just not line-counted. Treat a change there as needing a wasm test, since no coverage
    number will notice its absence.
  - **`codecov/patch` is blind on that crate too**, which matters because it is a required
    merge gate: a PR touching only `wad_document.rs` contributes zero coverable lines and
    passes trivially.
  - Deliberately **not** solved with an `ignore:` entry in `codecov.yml`. The omission is
    structural rather than chosen, and an `ignore:` would also silence genuinely measurable
    code added to that crate later — turning a visible gap into a permanent one.
- **The second structural blind spot: no check here can see a Svelte timing/lifecycle bug.**
  `svelte-check` proves types line up, `vitest` covers pure modules, and Playwright drives the
  built app — none of them observes reactivity wiring. There is **no Svelte component-test
  infrastructure**, and adding it is not a quick `@testing-library/svelte` install: every
  component in the map area draws to a canvas, and `happy-dom` implements no 2D context, so
  mounting one meaningfully needs a real browser. Tracked by **#129**.
  - **Three defects shipped past a fully green gate** in two consecutive PRs, all found by
    review rather than by a check: a label that could render an impossible `Grid · 64→32`
    (synchronous pref update racing an rAF draw, #128); a failed map keeping the *previous*
    map's label (an early return skipping an assignment, #128); and a live-region announcement
    cancelled mid-gesture (its debounce cleanup was wired to the redraw `$effect`, which tracks
    `transform` and so re-runs on every wheel tick — Svelte runs a cleanup before each re-run,
    so the announcement was lost rather than delayed, #127).
  - **The compensating controls are review and extraction**, and the second one is cheap:
    pushing display logic out of components into pure modules moves it somewhere `vitest` can
    reach. `gridLabel` and `gridDrawnSuffix` in `web/src/lib/views/map2d/grid.ts` were extracted
    exactly this way and both immediately caught regressions. **Prefer a pure function over a
    component-local `$derived` whenever the logic is worth a test.**
  - **Reach for the E2E harness before concluding something is untestable.** One of the three
    was already drivable: `web/e2e/helpers.ts` has `loadBrokenMapWad` (a PWAD whose `MAP01` is
    missing `VERTEXES`), which is precisely the failed-assembly path that shipped broken.
    Nobody looked.
- **The `CODECOV_TOKEN` secret is not load-bearing.** Verified 2026-08-10 (#109) by running a
  throwaway PR with `token: ''`: the upload succeeded and `codecov/patch` posted. Tokenless
  upload works on this public repo, so runs that receive no Actions secrets — **Dependabot PRs**
  (this repo has no Dependabot secrets) and **fork PRs** — degrade gracefully instead of failing
  a required check. The token is kept because an authenticated upload avoids whatever rate
  limiting and report-spoofing exposure the tokenless path carries, not because anything breaks
  without it.

  Reading the results:
  - `codecov/patch` (80% of the diff, per `codecov.yml`) arrives on a PR as a **check run**
    (so `gh pr checks` sees it) and on `main` as a **commit status**
    (`gh api repos/masriamir/crustyview/commits/<sha>/status`). It is a **required** check in
    the `Main Branch` ruleset as of #108 (app `codecov`, integration id 254). It posts even on
    a PR that changes no Rust — "Coverage not affected" — so requiring it does not wedge
    non-Rust work. The trade-off is deliberate: if Codecov stops reporting, PRs block instead
    of merging with a silently absent coverage signal, which is exactly what went unnoticed
    for three merges during the 2026-08-10 deactivation (#109). Use the admin bypass if that
    ever happens.
  - `codecov/project` is configured (`target: auto`, `threshold: 1%`) but has never been seen
    posting on this repo — don't block on it. **Re-checked 2026-08-10 after reactivation and
    it still does not post**, so #103's guess that it would resolve on a public plan is
    disproven; neither the plan nor the deactivation explains it (#99).
  - The `codecov[bot]` **PR comment** carries the missing-lines table the review loop gates on,
    but `require_changes: true` suppresses it when coverage is unchanged: a PR touching no Rust
    correctly gets **no comment**. Only a missing comment on a Rust-touching PR is a red flag.

## Copilot review loop
- Copilot review is requested by the **`Main Branch` ruleset**, not by a workflow. The ruleset
  existed from the start but was inert while the repo was private on a free plan; it activated
  when the repo went public (2026-08-10), and `.github/workflows/copilot-review.yml` — which had
  substituted for it — was retired then (#106).
- Three ruleset behaviours shape the review loop, and two of them replace manual steps:
  - `review_on_push: true` — **pushing to a PR triggers a fresh review by itself.** Re-requesting
    by hand is unnecessary; only reach for the manual recipe below when a request appears stuck.
  - `dismiss_stale_reviews_on_push: true` — the previous review is dismissed rather than lingering
    and being mistaken for a verdict on the new head.
  - `required_review_thread_resolution: true` — "never merge over an unresolved thread" is now
    enforced by the ruleset instead of by discipline.
- The ruleset also requires 11 status checks: `fmt`, `clippy`, `test`, `wasm-build`,
  `security-deny`, `pr-title`, `coverage`, `wasm-test`, `web-build`, `sweep-freedoom`, and
  `codecov/patch`. Merges are squash-only by ruleset as well as by repo setting (#97).
  What is deliberately **excluded**, and why — re-affirmed by the #108 audit:
  - **`web-e2e`** — a documented smoke signal, not a merge gate.
  - **`pr-type`** — advisory by construction; it can never fail, so requiring it would gate
    on nothing.
  - **`analyze` (CodeQL)** — deferred, not declined, and the reason is a trap worth knowing:
    GitHub treats a check run whose conclusion is `skipped` as **satisfying** a required
    check. While `codeql.yml` still carries `if: github.event.repository.visibility ==
    'public'`, the job can skip and the gate would pass by not running (observed on
    `191cfc0`: `analyze` → `skipped`). Require it only after #112 removes that guard. Note
    `analyze` (app `github-actions`, the job) and `CodeQL` (app `github-advanced-security`,
    the code-scanning result) are **different checks** — the latter is absent entirely when
    no analysis uploads, so requiring it blocks rather than silently passes.
- Three ruleset parameters that look like defaults but are decisions (#108):
  - **`bypass_actors`: admin, mode `always`** — load-bearing, do not narrow. `just release`
    pushes the release commit **directly to `main`** with `git push --follow-tags` (ADR-0004),
    which the `pull_request` rule would otherwise reject; both `chore(release)` commits
    reached `main` with no PR. Bypass mode `pull_request` only bypasses inside a PR, so it
    would break releases.
  - **`strict_required_status_checks_policy: true`** — a PR must be up to date with `main`
    before merging. Costs an update-branch round-trip; kept because it prevents a green PR
    merging against a base it was never tested with.
  - **`required_approving_review_count: 0`** — Copilot is requested by the ruleset but
    **cannot approve**, and there is no second human. Any value above 0 would make merging
    impossible. Unresolved threads are what actually block, via
    `required_review_thread_resolution`.
- Copilot renders **differently on every surface** — mixing them up breaks scripts:

  | Surface | Rendering |
  |---|---|
  | REST reviewer-request slug (the POST) | `copilot-pull-request-reviewer[bot]` — the `[bot]` suffix is required *only* here |
  | GraphQL `reviewRequests` | `copilot-pull-request-reviewer`, as a **`Bot`** node |
  | Timeline `review_requested` event | `Copilot` |
  | REST review **author** (`reviews`) | `copilot-pull-request-reviewer` — match this when polling |
  | REST `requested_reviewers` | **never appears at all** — the field lists Users only |

- **Never confirm a request from `requested_reviewers` or from the POST's response.** That field
  cannot hold a bot, and the POST answers 200 with an empty `requested_reviewers` array whether
  or not the request took — a request for a login that does not exist returns the same body.
  GraphQL is the only surface that knows:
  ```sh
  gh api graphql -F owner=masriamir -F name=crustyview -F pr=<N> -f query='
    query($owner:String!, $name:String!, $pr:Int!) { repository(owner:$owner, name:$name) {
      pullRequest(number:$pr) { reviewRequests(first:100) { nodes {
        requestedReviewer { ... on Bot { login } } } } } } }' \
    --jq '.data.repository.pullRequest.reviewRequests.nodes[] | .requestedReviewer.login // empty'
  ```
  Prints `copilot-pull-request-reviewer` when a request is pending, nothing otherwise. Match the
  login rather than counting: `totalCount` counts **every** pending reviewer, so a waiting human
  would read as a waiting Copilot.
- Manual (re-)request — rarely needed now that `review_on_push` covers the normal case:
  `gh api --method POST repos/masriamir/crustyview/pulls/<N>/requested_reviewers -f 'reviewers[]=copilot-pull-request-reviewer[bot]'`, then verify with the query above.
- **A pending request cannot be re-kicked.** A second POST returns 200, emits no
  `review_requested` timeline event and changes nothing, and REST `DELETE` cannot remove a bot
  (422, *"Could not resolve to User node"*). To unstick one, clear the whole reviewer set with
  GraphQL and request again:
  ```sh
  PRID=$(gh api repos/masriamir/crustyview/pulls/<N> --jq .node_id)
  gh api graphql -f query="mutation { requestReviews(input: {pullRequestId: \"$PRID\",
    userIds: [], union: false}) { clientMutationId } }"
  ```
  A genuine re-issue shows as `review_request_removed` then `review_requested` in the timeline;
  reviews have been observed taking up to ~14 minutes normally, so give it time before
  concluding it is stuck.
- Work the comments with the personal `resolving-bot-pr-reviews` skill across as many rounds
  as needed. CI command: `just ci` — a fast **subset** of the CI jobs (fmt, clippy native
  *and* wasm, test, wasm build, deny), not a mirror: it does not run `wasm-test`,
  `web-build`, `coverage`, `sweep-freedoom`, or `web-e2e`, so a green `just ci` is
  necessary but not sufficient. `gh pr checks` remains the source of truth. Owner/repo:
  `masriamir/crustyview`.
- A PR is ready for human review only when **all** Copilot threads are resolved **and** all
  CI checks pass (`gh pr checks`). The ruleset now enforces both — unresolved threads and the
  10 required checks block the merge — so this is no longer discipline alone. Two things still
  are, because they are outside the ruleset: the codecov comment's missing-lines table, and the
  advisory `pr-type` warning.

## Not yet built (tracked on the board)
- The virtualized texture and lump browsers (need the `textureRgba(name)` contract change
  and a lump-directory query) and the wgpu 3D viewport — decided (ADR-0002/ADR-0003), staged
  across epics #7/#8 and milestones `Viewer shell` / `2D map` / `3D viewport`.
- Publishing / hosted deployment.
