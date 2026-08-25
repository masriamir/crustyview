@AGENTS.md

# CLAUDE.md — crustyview

Claude-only operating notes for this repo. The shared, tool-neutral guidance (dependency rule,
layout, conventions, workflow, testing) lives in [`AGENTS.md`](AGENTS.md), imported above; this
file adds only what is specific to Claude driving the work here.

## Project tracking

Work is tracked on the shared **[Crustywad GitHub Project #5](https://github.com/users/masriamir/projects/5)** — crustyview issues live on the same board as crustywad. **Every change** — feature, bug, chore, docs, spike — gets a GitHub issue, added to the board with three planning fields:

- **Status:** `Backlog` → `Ready` → `In progress` → `In review` → `Done`. Most transitions are agent-driven (below); `Done` is board-automated on merge/close.
- **Horizon:** `Now` / `Next` / `Later` — planning intent for unmilestoned items.
- **Milestone** (per-repo, scope-named, never version numbers): `Viewer shell`, `2D map`, `3D viewport`. Record shipped versions in the description at closeout. GitHub never auto-closes milestones — when a milestone's issues are all closed, propose closing it rather than closing it unilaterally.

**Epics** (`epic` label) use native GitHub sub-issues for progress rollup: **#7 viewer shell & UI**, **#8 3D renderer**. Attach each new feature issue as a sub-issue of its epic. An epic moves to `In progress` when its first sub-issue starts and to `Done` (board-automated) only when all its sub-issues close; set the epic's aggregate Status by hand, since GitHub doesn't roll Status up.

**Labels** mirror crustywad's general-purpose taxonomy (`epic`, `spike`, `testing`, `chore`, `maintenance`, `security`, `performance`, `release`, plus triage labels) with three crustyview domain labels: `renderer` (wgpu/3D viewport), `web-ui` (Svelte/TS shell), and `accessibility` (a11y work across the shell and map views).

### Issue status transitions (agent-driven)

<!-- >>> meta:board-transitions -->
Move the GitHub Project board yourself as work progresses and **announce each change** in your reply ("moved #201 → In progress") rather than asking first — board edits are internal and easily reversed.

| Transition | Trigger |
|---|---|
| `Backlog → Ready` | the user says they want to start work on an issue |
| `Ready → In progress` | you begin brainstorming or drafting a plan — **before** any branch or code |
| `In progress → In review` | the PR opens |
| `In review → Done` | the PR merges/closes — **board-automated**, not manual |

`In review` holds through the entire review loop, until human review and merge. Transitions apply only to an issue that is on the board; if one exists but isn't on the board, add it first. Epics carry an **aggregate** Status: `In progress` when their first sub-issue starts work, and `Done` (board-automated) only when every sub-issue closes — set the epic's Status yourself and announce it, since GitHub rolls up completion progress but not the Status field.
<!-- <<< meta:board-transitions -->

The `gh` recipes (project id, Status/Horizon field + option IDs) are shared with crustywad — Project #5's fields are project-level, identical for crustyview items.

## Copilot review loop

The shared readiness policy is in `AGENTS.md`; the crustyview-specific mechanics are below.

- Copilot review is requested by the **`Main Branch` ruleset**, not by a workflow. The ruleset
  existed from the start but was inert while the repo was private on a free plan; it activated
  when the repo went public (2026-08-10), and `.github/workflows/copilot-review.yml` — which had
  substituted for it — was retired then (#106).
- Three ruleset behaviors shape the review loop, and two of them replace manual steps:
  - `review_on_push: true` — **pushing to a PR triggers a fresh review by itself.** Re-requesting
    by hand is unnecessary; only reach for the manual recipe below when a request appears stuck.
  - `dismiss_stale_reviews_on_push: true` — the previous review is dismissed rather than lingering
    and being mistaken for a verdict on the new head.
  - `required_review_thread_resolution: true` — "never merge over an unresolved thread" is now
    enforced by the ruleset instead of by discipline.
- The ruleset also requires 13 status checks: `fmt`, `clippy`, `test`, `wasm-build`,
  `security-deny`, `pr-title`, `coverage`, `wasm-test`, `web-build`, `sweep-freedoom`,
  `codecov/patch`, `analyze`, and `web-browser-test`. Merges are squash-only by ruleset as
  well as by repo setting (#97). The shared enforcement wiring also produces `pr-title / pr-title`
  and `meta-check / meta-check`; verify against the live ruleset (recipe below) whether they are
  yet required contexts rather than assuming — read the ruleset, not this inventory, when the
  count matters.

  **This list drifts, and it drifted silently once already.** `analyze` became required when
  #112 removed the guard that had deferred it, and this inventory went on calling it excluded
  until #140 noticed. Read the ruleset, not this paragraph, when the answer matters:
  `gh api repos/masriamir/crustyview/rulesets/20409829 --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'`

  Two things about the required list that are easy to get wrong:
  - **A check run whose conclusion is `skipped` SATISFIES a required check.** So a required
    job that can skip gates on nothing. This is not hypothetical — while `codeql.yml` carried
    `if: github.event.repository.visibility == 'public'`, `analyze` skipped and would have
    passed by not running (observed on `191cfc0`). That guard is gone, and neither `analyze`
    nor `web-browser-test` carries an `if:` or a `paths:` filter today. **Adding one to a
    required job silently disarms it**, which is the single most important thing to know
    before editing either job.
  - **`analyze` and `CodeQL` are different checks.** `analyze` (app `github-actions`) is the
    job; `CodeQL` (app `github-advanced-security`) is the code-scanning result, and it is
    absent entirely when no analysis uploads — so requiring *that* one blocks rather than
    silently passes. The ruleset requires `analyze`.

  What is deliberately **excluded**: `web-e2e` (a documented smoke signal, not a merge gate) and
  `pr-type` (advisory by construction; it can never fail, so requiring it would gate on nothing).

- Three ruleset parameters that look like defaults but are decisions (#108):
  - **`bypass_actors`: admin, mode `always`** — load-bearing, do not narrow. `just release`
    pushes the release commit **directly to `main`** with `git push --follow-tags` (ADR-0004),
    which the `pull_request` rule would otherwise reject.
  - **`strict_required_status_checks_policy: true`** — a PR must be up to date with `main`
    before merging; kept because it prevents a green PR merging against a base it was never
    tested with.
  - **`required_approving_review_count: 0`** — Copilot is requested by the ruleset but
    **cannot approve**, and there is no second human. Any value above 0 would make merging
    impossible. Unresolved threads are what actually block, via
    `required_review_thread_resolution`.
- Copilot renders **differently on every surface** — mixing them up breaks scripts. Measured
  against PR #147 on 2026-08-14 (`.user.id` is `175728472` throughout, so these are one identity
  wearing five names, not five accounts):

  | Surface | Rendering |
  |---|---|
  | REST reviewer-request slug (the POST) | `copilot-pull-request-reviewer[bot]` |
  | REST review **author** (`pulls/N/reviews` → `.user.login`) | `copilot-pull-request-reviewer[bot]` |
  | REST review-**comment** author (`pulls/N/comments` → `.user.login`) | **`Copilot`** — *not* the same string as the row above |
  | Timeline `review_requested` event | `Copilot` |
  | GraphQL — `reviewRequests`, review author, thread-comment author | `copilot-pull-request-reviewer`, always a **`Bot`** node |
  | REST `requested_reviewers` | **never appears at all** — the field lists Users only |

  **Match on GraphQL, which uses one login everywhere, or on `.user.id`/`.user.type == "Bot"`,
  which no surface varies.** A login mismatch is silent and fails toward "nothing is there": a
  `--jq 'select(.user.login=="…")'` miss yields an empty list, so a review-poll reads an
  already-submitted review as *not yet submitted* and waits out its stall timeout (happened on
  #147 / #149: five reviews existed, the poll reported none). Confirm a request via GraphQL
  `reviewRequests` (matching the login, not counting — `totalCount` counts every pending reviewer),
  never from `requested_reviewers` or the POST's 200 response.
- **A pending request cannot be re-kicked.** A second POST returns 200, emits no
  `review_requested` timeline event and changes nothing, and REST `DELETE` cannot remove a bot
  (422). To unstick one, clear the whole reviewer set with GraphQL, then re-POST the request:
  ```sh
  PRID=$(gh api repos/masriamir/crustyview/pulls/<N> --jq .node_id)
  gh api graphql -f query="mutation { requestReviews(input: {pullRequestId: \"$PRID\",
    userIds: [], union: false}) { clientMutationId } }"
  gh api --method POST repos/masriamir/crustyview/pulls/<N>/requested_reviewers \
    -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
  # then confirm the request is pending (prints copilot-pull-request-reviewer, else nothing):
  gh api graphql -F owner=masriamir -F name=crustyview -F pr=<N> -f query='
    query($owner:String!, $name:String!, $pr:Int!) { repository(owner:$owner, name:$name) {
      pullRequest(number:$pr) { reviewRequests(first:100) { nodes {
        requestedReviewer { ... on Bot { login } } } } } } }' \
    --jq '.data.repository.pullRequest.reviewRequests.nodes[] | .requestedReviewer.login // empty'
  ```
  The clear mutation alone leaves no pending request — the POST is what re-requests, and the query
  confirms it (match the login, not a count). A genuine re-issue shows as `review_request_removed`
  then `review_requested` in the timeline;
  reviews have been observed taking up to ~14 minutes normally, so give it time before
  concluding it is stuck.
- Beyond the ruleset-enforced gates (threads + required checks), two things stay judgment calls
  because they are outside the ruleset: the codecov comment's missing-lines table, and the
  advisory `pr-type` warning.

## Dependabot PRs

They merge by a different route than a hand-written PR. What makes the traps below worth
writing down is that several of them are not loud — the merge looks perfectly fine and
something is left unverified or quietly broken. Each one names its own failure mode; do not
rely on a red check to catch any of them.

**The sequence, per PR:** update the branch → comment `@dependabot recreate` → wait for the
rebuild → verify the required checks on the **new** head → merge. **Do not merge between the
update and the recreate**; that window is the state the rule exists to avoid. `@dependabot
rebase` is a different command and is not this.

**Why a recreate rather than just an update.** `strict_required_status_checks_policy: true`
means the PR must be up to date with `main` before it can merge, and `main` moves often.
Updating the branch through GitHub produces a merge commit Dependabot did not author, leaving
the PR in a state it no longer fully owns; `recreate` rebuilds it from scratch so the branch,
the commit and the metadata are consistent again. Each merge also puts the *remaining* PRs
behind `main`, so a queue of them is worked strictly one at a time.

They are `chore(deps)`, which `cliff.toml` marks `skip = true` — they never reach
`CHANGELOG.md` and never move the version. Merge them for currency, not for release notes.

Three failures that actually happened, and one thing they should not be taken to prove:

- **`gh pr update-branch` fails on a workflow-touching PR without a `workflow` token scope**,
  and says so. Not fatal — `recreate` rebuilds from current `main` anyway — but it is easy to
  skim past. The signal that actually matters is `mergeStateStatus` reading **`CLEAN`** rather
  than `BEHIND`, which under the strict policy is precisely the up-to-date proof. Observed on #137.
- **A green CI run does not always exercise the bumped action.** Both `upload-artifact` uses in
  `ci.yml` are `if: failure()`, so a passing run never invokes them and #136's three-major bump
  proved only that the YAML parsed. Read the action's inputs at the pinned SHA instead:
  ```sh
  gh api "repos/actions/upload-artifact/contents/action.yml?ref=<sha>" --jq .content | base64 -d
  ```
  Quote the URL — zsh globs the `?` and the call fails with `no matches found`.
- **Dependabot can propose half a change.** `github/codeql-action/init` and `.../analyze` are
  two dependencies to it but one version to CodeQL, so #135 bumped only `init` and CodeQL
  failed. **Before merging any action bump, check whether that action appears more than once in
  the workflows.** #169 fixed this pair with a `groups:` entry in `.github/dependabot.yml`;
  `taiki-e/install-action` must **not** get it — its several SHAs are one per *tool*, not one
  per release.
- **What made that one survivable was the shape of its failure, not the process.** CodeQL
  errored outright and `analyze` is required, so the PR blocked. A mismatch that *degraded*
  rather than errored would have left every required check green. So the "does this action
  appear twice?" question is the control; a red check is luck.

Dependabot PRs also receive no repository secrets, which is fine here: the tokenless Codecov
upload works on this public repo, so `codecov/patch` still posts.
