# ADR-0004: Versioning and release policy — single workspace version, git-cliff over release-plz

- **Status:** Accepted
- **Date:** 2026-08-09
- **Deciders:** Amir Masri
- **Tracking issue / PR:** #83 · PR #87 (`chore/83-versioning-policy`)

## Context and problem statement

crustyview has never had a tagged release: all three crates carry an
independent `0.1.0` with `publish = false`, and `web/package.json` is
`private: true` with no version field at all. Nothing consumes crustyview —
it is in no registry and nothing pins it — so no external contract forces a
version scheme. Two purposes drove taking one on now anyway: a human-readable
changelog for people following the repo, and a version string that names a
specific deployed build once it matters which build a bug report came from
(epic #44). Milestone punctuation and any badge/shield display (#59) were
explicitly not drivers here.

crustywad, the sibling repo crustyview depends on, already has a working
release pipeline built on release-plz. The natural first move was to reuse
it.

## Decision drivers

- A changelog and a build-identifying version string are needed now
  (epic #44); milestone/badge ceremony (#59) is explicitly not a driver.
- crustyview is a 3-crate workspace (`crustyview-core`, `crustyview-web`,
  `crustyview-native`) plus a Vite/Svelte app in `web/`, none of it published
  anywhere — any tool that assumes packages resolve from a registry is
  suspect.
- Reuse crustywad's existing tooling if it actually works here, rather than
  inventing a second release process to maintain.
- No new CI surface (GitHub App install, repo secrets) unless the payoff
  justifies it.
- The bump mapping has to be evaluated on crustyview's own terms, not copied
  from crustywad by assumption.

## Considered options

1. Continue with no version policy (status quo) — per-crate `0.1.0`, no tags,
   no changelog.
2. release-plz, matching crustywad.
3. git-cliff, driven by a local `just release` recipe. *(Chosen.)*

## Decision outcome

Chosen option: **3 — git-cliff via a local `just release` recipe.** Option 2
(release-plz) was tried first, since crustywad already runs it successfully,
but it does not work here: `release-plz update` shells out to `cargo package`
to determine the next version, and `cargo package` cannot resolve
intra-workspace path dependencies that have never been published to
crates.io. Verified directly against **release-plz 0.3.160**: with no version
requirement on the intra-workspace dependency, `cargo package` fails with
`all dependencies must have a version requirement specified when packaging`;
adding one instead makes it search crates.io and fail with
`no matching package named crustyview-core found, location searched:
crates.io index`. There is no manifest shape between those two that dodges
both. This is a known upstream bug,
[release-plz/release-plz#2595](https://github.com/release-plz/release-plz/issues/2595),
open since 2026-01-20; the partial fix in #2655 (merged 2026-03-07) covers
only path dependencies on the *root* package, not the three-crate shape here.
Option 2 is out unless #2595 closes upstream, or the crates are eventually
published (tracked, not solved, by #86).

git-cliff has no such coupling: it derives versions and changelog entries
purely from git history — tags and Conventional Commit messages — with no
notion of cargo packages or workspace membership. `scripts/release.sh` wraps
it: compute the next version with `git-cliff --bumped-version`, stamp it into
`[workspace.package].version` (Task 1 of this work), regenerate the root
`CHANGELOG.md`, commit, and tag `v<version>`. It is invoked as `just release`
(or `just release --dry-run` to preview).

Within that choice, the concrete policy is:

1. **One product version.** `[workspace.package].version`, inherited by all
   three crates. One tag `v<version>`, one root `CHANGELOG.md` — not
   per-crate versions or changelogs.
2. **Conventional-commit bump semantics**, encoded in `cliff.toml`'s `[bump]`
   table: `feat:` → minor, `fix:`/`docs:`/`perf:` → patch, a `!` or
   `BREAKING CHANGE:` footer → minor while the workspace is 0.x and major
   from 1.0 on. An MSRV raise gets no special-cased bump — it's whatever its
   own commit type implies.
3. Releases are cut by **`just release`**, run locally by a maintainer — not
   by CI, and not by a bot-authored release PR.
4. The build string rendered in the status bar is sourced from
   `env!("CARGO_PKG_VERSION")` inside the wasm build plus a Vite-injected git
   SHA (issue #84 — a separately filed, separately implemented piece of
   work; not built by this ADR).

### Consequences

- Good, because the changelog and version now derive from commit history
  instead of being hand-maintained.
- Good, because no GitHub App installation and no repository secrets are
  needed — the whole release path runs on a maintainer's machine.
- Good, because the same bump rules apply uniformly across the workspace
  crates and `web/`; verified directly (see More information) that
  `web/`-only changes are picked up correctly, since git-cliff reads git
  history rather than cargo package boundaries.
- Bad, because nothing nudges anyone when unreleased changes accumulate —
  release-plz's release PR served as that reminder in crustywad, and there is
  no equivalent here. Cutting a release is now something a maintainer has to
  remember to do.
- Bad, because the crustyview bump mapping is not the crustywad bump mapping,
  so it does not transfer by copy-paste between the two repos; see below.
- Neutral, because while at 0.x, `feat:` and a breaking change both land on a
  minor bump, so the version number alone doesn't distinguish "new
  capability" from "breaking change"; see below.
- Neutral, because the status-bar build string (#84) only renders where the
  status bar itself renders — desktop widths. `.status-bar` is
  `display: none` below `48rem`, the same mobile gap #79 already tracks for
  map stats; not solved by this ADR.

**Why the bump mapping diverges from crustywad, on purpose.** crustywad maps
`feat:` → *patch* and reserves *minor* for breaking changes. That's because
crustywad is consumed via a `0.MINOR` caret requirement
(`crustywad = "0.9"` = `>=0.9.0, <0.10.0`, per
[ADR-0001](0001-consume-crustywad-via-pinned-wasm.md)) — Cargo auto-upgrades
a pinned consumer across patch releases but never across a minor bump.
Mapping `feat:` to patch means new capability reaches a pinned consumer
automatically, while minor stays reserved as the "this may break you" signal
that requires a deliberate version bump on the consumer's side. crustyview
has no such consumer: nothing depends on it, nothing pins it with a caret
requirement, and every crate is `publish = false`. The reasoning that
justifies crustywad's inversion doesn't transfer, so this ADR does **not**
align the two repos' mappings — doing so would compress every crustyview
feature release into a patch bump for no reason, since there is no pinned
consumer here to protect.

**Why same-minor for `feat:` and breaking changes while 0.x is acceptable.**
SemVer's own pre-1.0 convention doesn't require the version number to
distinguish additive from breaking changes yet, and there is no downstream
resolver relying on crustyview's version to decide whether an upgrade is
safe, because nothing depends on crustyview. The `!` / `BREAKING CHANGE:`
marker still carries the signal explicitly in the generated changelog, so the
information isn't lost — it's just not yet encoded in the number. That
distinction becomes load-bearing once crustyview reaches 1.0, at which point
`breaking_always_bump_major` should flip to `true`.

## Pros and cons of the options

### 1 — Status quo (no policy)

- Good, because it costs nothing to maintain.
- Bad, because there is no changelog and no way to name a deployed build,
  which is the problem epic #44 exists to solve.

### 2 — release-plz, matching crustywad

- Good, because crustywad already runs it successfully, so no new tooling
  concept would be needed across the two repos.
- Bad, because `release-plz update` cannot complete in an unpublished
  multi-crate workspace: `cargo package` fails on unresolved intra-workspace
  dependencies regardless of manifest shape (release-plz/release-plz#2595,
  verified on 0.3.160; the partial fix in #2655 doesn't cover this shape).
- Bad, because it requires a GitHub App and repo secrets crustyview
  otherwise doesn't need.

### 3 — git-cliff via a local `just release` recipe (chosen)

- Good, because it reads only git history — no dependency on cargo's
  package/publish machinery — so it works unmodified against an unpublished
  multi-crate workspace.
- Good, because it needs no CI credentials at all; the whole release is a
  local script.
- Bad, because cutting a release is a manual, memory-dependent action with no
  automated reminder (no release PR) when changes pile up.

## More information

- Builds on [ADR-0001](0001-consume-crustywad-via-pinned-wasm.md) — the
  `0.MINOR` caret pin on crustywad is the reasoning deliberately *not*
  transferred here — and on
  [ADR-0002](0002-hybrid-portable-core-svelte-shell.md) /
  [ADR-0003](0003-viewer-ui-ux-sidebar-shell.md) for the status-bar surface
  the build string (#84) renders into.
- The policy is encoded in `cliff.toml`'s `[bump]` table and exercised by
  `scripts/release.sh` / `just release`. End-to-end bump semantics were
  verified against the real tooling on a throwaway branch and tag (both
  since deleted, leaving zero tags in the repo): `feat:` → `0.2.0`, `fix:` →
  `0.1.1`, `feat!:` → `0.2.0` (not `1.0.0`), `chore:` → no changelog entry
  and no version change. All four matched on the first run. Every one of
  those test commits touched only `web/src/app.css` — a file outside the
  cargo workspace — so the same run also demonstrates that `web/`-only
  changes are visible to the tooling, which is the property release-plz
  could not provide.
- Issue #86 tracks revisiting release-plz if upstream #2595 closes, or if the
  crates are ever published; no implementation work is scoped there today.
- **Revisit if:** release-plz/release-plz#2595 closes upstream, or
  crustyview's crates are ever published (#86) — either could remove the
  blocker that ruled out option 2; or when crustyview reaches 1.0, at which
  point `breaking_always_bump_major` should flip to `true` and the
  same-minor overlap noted above ends.
