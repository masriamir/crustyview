# AGENTS.md — crustyview

Shared, tool-neutral guidance for any agent working in `crustyview`. Claude reads it via the
`@AGENTS.md` import in `CLAUDE.md`; GitHub Copilot code review reads it directly. Sections marked
with `meta:` markers are canonical blocks synced from `masriamir/.github` — edit them upstream,
not here (see `.meta-manifest.toml` and `just meta-check`).

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

## Commit conventions

<!-- >>> meta:commit-conventions -->
Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat` (new functionality), `fix` (bug fix), `docs` (documentation only), `test` (test-only), `refactor` (no behavior change), `chore` (build/tooling), `ci` (CI workflows). Scope is encouraged — `feat(map):`, `fix(cli):`.

**Mark breaking changes** with `!` (`feat(map)!: remove RejectLump`) or a `BREAKING CHANGE:` footer. Release automation derives the version bump from these annotations, so an unmarked breaking change proposes a semver-violating patch release.

**The PR title is the changelog entry and the version bump.** PRs squash-merge to a single commit whose subject is the PR title and whose body is blank — every branch commit subject is discarded. So the PR title alone selects the changelog section and drives the derived bump. Write it as a real Conventional Commit describing the shipped outcome; never `gh pr create --fill` (it takes the title from the branch name). Title a mixed PR by its highest-impact change (`!` > `feat` > `fix` > everything else), or split it into one PR per type when both halves each earn a changelog line. Never hand-force a version to compensate for a title.
<!-- <<< meta:commit-conventions -->

Crustyview specifics: releases are cut **locally**, never in CI — `just release` (`--dry-run` to
preview) bumps `[workspace.package].version` from Conventional Commits, regenerates `CHANGELOG.md`
via git-cliff, commits, and tags `v<version>`; push with `git push --follow-tags`. `chore:`/`ci:`/
`build:` are `skip = true` in `cliff.toml`, so a run with only those refuses rather than re-tagging,
and a `chore:`-titled feature is silently dropped from the changelog and skips the bump.
release-plz is deliberately **not** used (ADR-0004). The PR-title **form** is checked by CI's
`pr-title` job, which shares `scripts/check-conventional-subject.py` with lefthook's `commit-msg`
hook (one source of truth, so the two gates cannot drift); it is a **required** check. Whether the
chosen **type** fits the change is a human judgement, given a heuristic second opinion by the
advisory `pr-type` job (warns when a `skip = true` title touches `crates/*/src/**`,
`crates/*/tests/**` or `web/src/**`; never fails a build).

## Git branching workflow

<!-- >>> meta:branch-naming -->
Branch from `main` after a `git pull`. Name every branch `<type>/<slug>` where `type` is one of `feature`, `bugfix`, `hotfix`, `docs`, or `chore`. The slug is descriptive and always required — a bare number such as `feature/42` is rejected — and is prefixed with the issue number when a tracking issue exists (`feature/42-mmap-support`). The number is optional in the pre-push hook but expected for the issue-driven `feature`/`bugfix`/`hotfix` types; `docs`/`chore` branches commonly omit it.

**Release branches are not used.** Release automation handles version bumps, changelog, and tags from the Conventional Commits on `main`; merge the release PR to ship.
<!-- <<< meta:branch-naming -->

Crustyview specifics: `just lint` / `just test` before pushing. **Every `uses:` in
`.github/workflows/` is pinned to a 40-character commit SHA**, with the human-readable ref in a
trailing comment (`actions/checkout@3d3c42e5… # v7`); a tag or branch ref is mutable, so an
unpinned action is an unreviewed third party with write access to the CI that gates `main`. Three
details that are easy to get wrong: branch refs get pinned too and say so
(`dtolnay/rust-toolchain@4360b525… # stable branch pin` — this freezes the *action*, not the Rust
toolchain); `taiki-e/install-action`'s ref is the tool name, so its comment must be the tool
(`# cargo-deny`), not a version; and never hand-write a SHA — resolve it
(`gh api repos/<owner>/<repo>/commits/<ref> --jq .sha`) and keep the comment matching. Bumps are
Dependabot's job (`.github/dependabot.yml`, weekly).

## Decisions
- Architectural / hard-to-reverse decisions are recorded as ADRs in
  [`docs/adr/`](docs/adr/) — lightweight (structure mirrors crustywad, without the
  library-publishing ceremony). See [`docs/adr/README.md`](docs/adr/README.md) for the
  process; [ADR-0001](docs/adr/0001-consume-crustywad-via-pinned-wasm.md) records the
  pinned-release WASM-consumer decision, and
  [ADR-0002](docs/adr/0002-hybrid-portable-core-svelte-shell.md) records the hybrid UI
  architecture — a portable Rust/`wgpu` core (`crustyview-core`) behind a Svelte + TypeScript
  shell (`crustyview-web`), with `crustyview-native` proving portability; wgpu = 3D only,
  everything 2D/DOM in TypeScript.
  [ADR-0003](docs/adr/0003-viewer-ui-ux-sidebar-shell.md) records the viewer UI/UX —
  a sidebar shell (header · tree · main view · status bar) with state-driven navigation
  (no URL router), domain stores (`wad`/`nav`/`theme`), tokened light/dark theming, and a
  first-class compact layout (bottom nav + push navigation below 48rem).
  [ADR-0004](docs/adr/0004-versioning-and-release-policy.md) records versioning and
  releases — one product version in `[workspace.package]` inherited by all three crates,
  one tag `v<version>`, one root `CHANGELOG.md`, cut locally by `just release` via git-cliff.

## Code conventions

- Rust 2024, no MSRV pin of its own (it mirrors crustywad's `rust-version`). `clippy::all` +
  `pedantic` are warnings locally; CI treats warnings as errors. Prefer `T::try_from(..)` over
  `as` casts to stay clean under `clippy::pedantic`.
- WAD-consuming logic is native-testable (`summary`, `probe`, `map2d`); wasm-bindgen glue is
  wasm32-only. Do not add publishing machinery (release-plz, dist, crates.io) — this crate is
  `publish = false`.

### Language

<!-- >>> meta:language-en-us -->
- **American English spelling everywhere** — not only documentation: identifiers, code comments, doc comments, CLI and other user-visible output, commit messages and PR text. Take the American form of every `-ise`/`-ize`, `-our`/`-or`, `-re`/`-er` and `-ae`/`-e` pair: `initialize`, `honor`, `center`, `artifact`, `color`, `behavior`, `analyze`.
- **Third-party vocabulary keeps its own spelling.** GitHub Actions' job-status literal is `cancelled`; a status value, API field or dependency identifier is quoted, never corrected. The rule governs our words, not other people's.
- **Applying or flagging this is not a mechanical find-and-replace.** Skip backticked code spans, and match the *pattern* (`-ise`/`-ize`, and the others above) rather than a literal wrong word — the American forms listed above are the intended spellings, not violations. Because a rule like this must name the very spellings it forbids, a blind sweep rewrites its own counter-examples: a bullet meaning "write `color`, not the `-our` form" gets flattened to "write `color`, not `color`", which forbids nothing.
- **Check spelling as you write, not only when reviewing** — text copied verbatim from upstream is the usual source of slips.
<!-- <<< meta:language-en-us -->

## UI conventions
- **WCAG 2.2 AA is the accessibility design target** (ADR-0007): every new control ships with
  a keyboard path, every visual state change either updates an accessible name or is announced
  through a live region, and text/non-text contrast holds 4.5:1 / 3:1 in both themes. The full
  canvas-equivalence and shell-focus policy lives in the ADR; violations found in shipped UI
  are `accessibility`-labeled defects, not polish.
- **A control's accessible name must contain its visible label — but a value readout in that
  label is not part of the label.** The 2D map's Grid button shows `Grid · 32→128` while its
  name is `Show grid, 32, drawn as 128`: the label is "Grid", and `· 32→128` is a value. Putting
  it in the name verbatim would speak "middle dot" and "right arrow" and make the announcement
  worse, so the name states the same value in words instead. Controls whose name comes from
  their contents (the map chips) cannot diverge and need no thought here. The same button has a
  third label state where the divergent part is a whole phrase, not just punctuation and a
  number: visible `Grid · 32 · zoom in` against the name `Show grid, 32, too small to draw at
  this zoom` — a harder sell under 2.5.3, and the case a future reader is more likely to stumble
  on than the coarsened case above. Recorded by #74's audit; adopted as policy by ADR-0007,
  which keeps this entry as the worked example.

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
- **Coverage measures the host target only.** `cargo llvm-cov` runs on the host, and
  `crustyview-web` gates its entire body on `#[cfg(target_arch = "wasm32")]`, so it compiles to
  nothing there and is invisible to the number — the report covers `crustyview-core` (six files)
  plus `crustyview-native/src/main.rs`, and **zero** lines of `crustyview-web`. The compensating
  control is **`wasm-test`** (a required check running `wasm-pack test --node`);
  `crates/crustyview-web/tests/web.rs` exercises all seven browser-API methods. Treat a change
  in `crustyview-web` as needing a wasm test, since no coverage number will notice its absence.
  `codecov/patch` is blind on that crate for the same reason. The `coverage` job uploads
  `lcov.info` with `fail_ci_if_error: true` and no `continue-on-error`, so a rejected upload
  turns CI red rather than passing silently.
- **The second structural blind spot has a compensating tier: `web-browser-test`
  (`npm run test:browser`).** `svelte-check` proves types, `npm test` (the `happy-dom` tier)
  covers pure modules, and Playwright drives the whole built app — none observes reactivity
  wiring at unit granularity. `web/vite.config.ts` defines a `browser` Vitest project running
  `web/src/**/*.browser.test.ts` under real headless Chromium via `@vitest/browser-playwright`;
  run it locally with `just test-browser` (one-time `just test-browser-install`). Reach for it
  when the bug is about *when* something happens (effect wiring, cleanup timing, rAF draws), not
  what it computes; reach for **pure-function extraction first** when the logic is pure (cheaper,
  lands in the fast `happy-dom` tier, and improves the code it tests). `map2d-mount.browser.test.ts`
  is the template to crib from; `grid-announcement.browser.test.ts` is the worked timing example.
  The canvas-path suites are pinned to `renderer: 'canvas'` deliberately — WebGL2 is the default
  (ADR-0006), so an unpinned mount would silently stop testing the fallback. `painted()`
  (`browser-test-helpers.ts`) is dual-context (2D `getImageData` / WebGL2 `readPixels`);
  `toDataURL()` on a GL canvas without `preserveDrawingBuffer` is a documented false green, which
  the E2E tier sidesteps by hashing pixels (`mapCanvasPixelHash`, gated behind `?glprobe=1`).

## Copilot review

<!-- >>> meta:copilot-review-loop -->
PRs are reviewed automatically by `copilot-pull-request-reviewer`. Work through its comments — review threads **and** the suppressed comments in the review body — across as many rounds as needed. Verify each finding against the actual code before acting; bots are sometimes wrong or working from a stale diff.

A PR is ready for human review only when **all** of these hold:

- every automated review thread is resolved,
- every required CI check passes (`gh pr checks`), and
- the codecov comment reports no uncovered changed lines (or each remaining miss is consciously justified).

Resolved threads over a red required check — or unaddressed missing coverage — do **not** make a PR ready. Whether a fresh review is auto-requested on push or must be requested by hand is a per-repo ruleset detail (`review_on_push`); check the ruleset when a request seems stuck rather than assuming.
<!-- <<< meta:copilot-review-loop -->

Crustyview specifics: `just ci` is a fast **subset** of CI (fmt, clippy native *and* wasm, test,
wasm build, deny) — it does not run `wasm-test`, `web-build`, `coverage`, `sweep-freedoom`,
`web-e2e`, or `web-browser-test`, so a green `just ci` is necessary but not sufficient;
`gh pr checks` is the source of truth. The `Main Branch` ruleset requests the review and enforces
thread resolution + the required checks; the operational detail (ruleset internals, the required
check list, Copilot's per-surface rendering, and the re-request recipe) lives in `CLAUDE.md`.

## Not yet built (tracked on the board)
- The virtualized texture and lump browsers (need the `textureRgba(name)` contract change
  and a lump-directory query) and the wgpu 3D viewport — decided (ADR-0002/ADR-0003), staged
  across epics #7/#8 and milestones `Viewer shell` / `2D map` / `3D viewport`.
- Publishing / hosted deployment.
