#!/usr/bin/env bash
# Cut a crustyview release: compute the next version from Conventional Commits,
# stamp it into [workspace.package], regenerate CHANGELOG.md, commit, and tag.
#
# Usage: scripts/release.sh [--dry-run]
#
# release-plz is not used here: it runs `cargo package` to determine versions,
# which cannot resolve unpublished intra-workspace deps (release-plz#2595).
set -euo pipefail

dry_run=false
[[ "${1:-}" == "--dry-run" ]] && dry_run=true

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! $dry_run && [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit or stash first" >&2
  exit 1
fi

next="$(git-cliff --bumped-version)"   # e.g. v0.2.0
ver="${next#v}"

if [[ ! "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: git-cliff returned an unusable version: '$next'" >&2
  exit 1
fi

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

# Read it back rather than trusting the write.
if ! awk "$read_version_awk" Cargo.toml | grep -qx "$ver"; then
  echo "error: version stamp verification failed; expected $ver" >&2
  exit 1
fi

# Refresh Cargo.lock so the commit is self-consistent. Also fails loudly if the
# rewrite produced a manifest cargo can't parse.
cargo metadata --format-version 1 --no-deps >/dev/null

git-cliff --tag "$next" -o CHANGELOG.md

git add Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore(release): $next"
git tag "$next"

echo "Tagged $next. Push with: git push --follow-tags"
