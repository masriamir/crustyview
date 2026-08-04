# CLAUDE.md — crustyview

Web-based Doom WAD reader/viewer built on crustywad (separate repo, pinned dependency).

## Dependency rule (load-bearing)
- Depend on a **pinned crustywad release** (`crustywad = "0.9"`). Do not path-depend on a local checkout.
- API friction / bugs → file an **issue on crustywad**, fix on its `main`, bump here on release.
- Urgent fixes only: uncomment the `[patch.crates-io]` git-main override in the root `Cargo.toml`.

## Layout
- `crates/crustyview/src/summary.rs` — native-testable summarization.
- `crates/crustyview/src/probe.rs`   — native-testable map/texture probes.
- `crates/crustyview/src/wasm.rs`     — wasm-bindgen glue (wasm32-only).
- `crates/crustyview/web/`            — minimal HTML/JS host page.

## Workflow
- Branch `<type>/<slug>`; Conventional Commits (lefthook enforces both).
- `just lint` / `just test` before pushing; PRs into `main`, Copilot review + green checks.

## Decisions
- Architectural / hard-to-reverse decisions are recorded as ADRs in
  [`docs/adr/`](../docs/adr/) — lightweight (structure mirrors crustywad, without the
  library-publishing ceremony). See [`docs/adr/README.md`](../docs/adr/README.md) for the
  process; [ADR-0001](../docs/adr/0001-consume-crustywad-via-pinned-wasm.md) records the
  pinned-release WASM-consumer decision.

## Testing
- `crates/crustyview/tests/wad_sweep.rs` sweeps a local WAD collection, gated by
  `CRUSTYVIEW_WAD_DIR` (prefer an **absolute** path — cargo runs tests with CWD
  set to the package root, so a relative value resolves against that, rarely what
  you intend; the `just sweep` recipe absolutizes it for you). It skips (passes)
  when the variable is unset, since commercial IWADs are never committed.
- `just sweep /abs/path` runs the native sweep; `just sweep-wasm /abs/path`
  runs the headless wasm sweep, driving the real `analyze`/`first_texture_rgba`
  wasm exports via `scripts/wasm-sweep.cjs` (builds the nodejs bundle first).
- `just fetch-freedoom` fetches the GPL Freedoom WADs for local use.
- CI runs the sweep automatically (`sweep-freedoom` job) against fetched Freedoom;
  commercial IWADs stay local-only.
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

## Out of scope (bootstrap)
- UI-framework choice (egui/bevy vs TS+wasm) — to be settled in a follow-up ADR
  (see [ADR-0001](../docs/adr/0001-consume-crustywad-via-pinned-wasm.md) §Consequences).
- Renderer / 3D viewport, full stats dashboard, publishing.
