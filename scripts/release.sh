#!/usr/bin/env bash
# Cut a crustyview release: compute the next version from Conventional Commits,
# stamp it into [workspace.package], regenerate CHANGELOG.md, commit, and tag.
#
# Usage: scripts/release.sh [--dry-run]
#
# release-plz is not used here: it runs `cargo package` to determine versions,
# which cannot resolve unpublished intra-workspace deps (release-plz#2595).
set -euo pipefail

# An EXIT trap (not ERR) so this fires on both a failing command under `set -e`
# AND an explicit `exit` — bash's ERR trap does not trigger for the latter, and
# several failure paths below (version-stamp verification, argument errors) exit
# explicitly. `phase` tracks how far the script got, because the right advice
# changes as it progresses: before any write, there's nothing to undo; once
# Cargo.toml/CHANGELOG.md are stamped but not committed, `git checkout` cleanly
# undoes them; once the release commit lands, checkout is wrong (history has
# already moved), so the advice shifts to inspecting and resolving that commit.
phase=clean
on_exit() {
  local rc=$?
  [[ $rc -eq 0 ]] && return
  case "$phase" in
    mutated)
      # All three files can be dirty here: Cargo.toml from the stamp, Cargo.lock
      # from `cargo metadata`, CHANGELOG.md from git-cliff. `git add` may also
      # have staged them already — hence `checkout HEAD --`, not `checkout --`,
      # which restores from the index and would preserve the staged changes.
      echo "error: release aborted with Cargo.toml/Cargo.lock/CHANGELOG.md modified but not committed." >&2
      echo "recover with: git checkout HEAD -- Cargo.toml Cargo.lock CHANGELOG.md" >&2
      ;;
    committed)
      echo "error: release commit landed but tagging failed; the commit exists without its tag." >&2
      echo "inspect it with: git log -1" >&2
      echo "then either tag it manually: git tag $next" >&2
      echo "or undo the commit: git reset --hard HEAD~1" >&2
      ;;
  esac
}
trap on_exit EXIT

# Parse every argument and reject anything unrecognised. Matching only "$1"
# would make a typo (`--dryrun`) or a wrapper that reorders arguments fall
# through to a REAL release — which commits and tags. Failing closed is the
# only safe default here.
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    # `just release -- --dry-run` forwards the separator literally. Accepting it
    # as a no-op costs nothing: it is explicit, so it can't be a typo that slips
    # through to a real release.
    --) ;;
    *)
      echo "error: unknown argument '$arg'" >&2
      echo "usage: scripts/release.sh [--dry-run]" >&2
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! $dry_run && [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit or stash first" >&2
  exit 1
fi

next="$(git-cliff --bumped-version)"   # e.g. v0.2.0

# Validate the TAG, not just the stripped version. `next` is what gets tagged,
# and an unprefixed value like `0.1.0` would pass a version-only check while
# violating the v<version> policy — and it would fall outside cliff.toml's
# anchored tag_pattern, making the tag invisible as the next release's baseline.
if [[ ! "$next" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: git-cliff returned an unusable tag: '$next' (expected vMAJOR.MINOR.PATCH)" >&2
  exit 1
fi
ver="${next#v}"

# Both passes below scope to the [workspace.package] table identically: `inblock`
# is re-evaluated at every table header, so a `version` key in any other table is
# never read or written. The header match tolerates trailing space and a comment.
read_version_awk='
  /^\[/ { inblock = ($0 ~ /^\[workspace\.package\][[:space:]]*(#.*)?$/) }
  inblock && /^version = / { gsub(/[^0-9.]/, ""); print; found = 1; exit }
  END { if (!found) exit 1 }
'

if ! current="$(awk "$read_version_awk" Cargo.toml)" || [[ -z "$current" ]]; then
  echo "error: no version key under [workspace.package] in Cargo.toml" >&2
  exit 1
fi

if $dry_run; then
  echo "current: $current"
  echo "next:    $ver  (tag $next)"
  echo "--- changelog preview ---"
  git-cliff --tag "$next" --unreleased
  exit 0
fi

# git-cliff silently returns the PREVIOUS tag (exit 0, "There is nothing to
# bump" on stderr) when only skip = true commit types (chore/ci/build, see
# cliff.toml) have landed since the last release. That value still satisfies
# the vMAJOR.MINOR.PATCH check above, so without this guard the script would
# sail into a real release on an unchanged version: stamp a no-op, regenerate
# the changelog, and successfully commit — only for `git tag` to fail
# afterward because the tag already exists, aborting under set -e with a
# spurious chore(release) commit left behind (and compounding on any retry).
if git rev-parse -q --verify "refs/tags/$next" >/dev/null; then
  echo "error: tag $next already exists — nothing to bump since the last release?" >&2
  exit 1
fi

# A silent no-op here would be the worst failure this script has: it would go on
# to write a changelog, commit, and tag a release whose manifest still declares
# the old version. So the pass exits non-zero unless it actually stamped a line.
if ! awk -v ver="$ver" '
  /^\[/ { inblock = ($0 ~ /^\[workspace\.package\][[:space:]]*(#.*)?$/) }
  inblock && /^version = / && !done { print "version = \"" ver "\""; done = 1; next }
  { print }
  END { if (!done) exit 1 }
' Cargo.toml > Cargo.toml.tmp; then
  rm -f Cargo.toml.tmp
  echo "error: could not stamp the version into [workspace.package] — has Cargo.toml's layout changed?" >&2
  exit 1
fi
mv Cargo.toml.tmp Cargo.toml
# Cargo.toml is now stamped and CHANGELOG.md is about to be written; a
# mid-mutation failure from here on is recoverable but not obvious, so arm
# the recovery hint.
phase=mutated

# Read it back rather than trusting the write. -F because `.` would otherwise be
# a regex wildcard, so "0.2.0" would also match a malformed "01210".
if ! awk "$read_version_awk" Cargo.toml | grep -qxF "$ver"; then
  echo "error: version stamp verification failed; expected $ver" >&2
  exit 1
fi

# Refresh Cargo.lock so the commit is self-consistent — `--no-deps` must NOT
# be used here, since it skips dependency resolution entirely and leaves
# Cargo.lock un-rewritten, so the release commit would carry a bumped
# Cargo.toml against a stale lock (`cargo build --locked` then fails at that
# tag). This also fails loudly if the rewrite produced a manifest cargo can't
# parse.
cargo metadata --format-version 1 >/dev/null

git-cliff --tag "$next" -o CHANGELOG.md

git add Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore(release): $next"
# The commit landed: Cargo.toml/CHANGELOG.md are no longer uncommitted
# mutations, so "git checkout -- ..." stops being the right recovery advice
# for anything that fails from here (e.g. `git tag`) — the advice shifts to
# resolving the now-untagged commit instead.
phase=committed
git tag "$next"

echo "Tagged $next. Push with: git push --follow-tags"
