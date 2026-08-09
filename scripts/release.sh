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

current="$(awk '/^\[workspace\.package\]/{b=1} b&&/^version = /{gsub(/[^0-9.]/,"");print;exit}' Cargo.toml)"

if $dry_run; then
  echo "current: $current"
  echo "next:    $ver  (tag $next)"
  echo "--- changelog preview ---"
  git-cliff --tag "$next" --unreleased
  exit 0
fi

# Scoped to the [workspace.package] table: a `version` key in any other table
# is left alone.
awk -v ver="$ver" '
  /^\[/ { inblock = ($0 == "[workspace.package]") }
  inblock && /^version = / && !done { print "version = \"" ver "\""; done=1; next }
  { print }
' Cargo.toml > Cargo.toml.tmp && mv Cargo.toml.tmp Cargo.toml

# Refresh Cargo.lock so the commit is self-consistent.
cargo metadata --format-version 1 --no-deps >/dev/null

git-cliff --tag "$next" -o CHANGELOG.md

git add Cargo.toml Cargo.lock CHANGELOG.md
git commit -m "chore(release): $next"
git tag "$next"

echo "Tagged $next. Push with: git push --follow-tags"
