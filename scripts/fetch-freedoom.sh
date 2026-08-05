#!/usr/bin/env bash
# Fetch Freedoom WADs (GPL, redistributable) for the sweep test.
# Usage: fetch-freedoom.sh <target-dir> [version]   (version default 0.13.0)
set -euo pipefail
target="${1:?usage: fetch-freedoom.sh <target-dir> [version]}"
version="${2:-0.13.0}"
version="${version#v}"
mkdir -p "$target"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
url="https://github.com/freedoom/freedoom/releases/download/v${version}/freedoom-${version}.zip"
echo "Fetching $url"
curl -fsSL "$url" -o "$tmp/freedoom.zip"
unzip -j -o "$tmp/freedoom.zip" "freedoom-${version}/freedoom1.wad" "freedoom-${version}/freedoom2.wad" -d "$target"
echo "Freedoom WADs in $target:"
ls -1 "$target"/*.wad
