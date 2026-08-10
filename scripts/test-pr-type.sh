#!/usr/bin/env sh
# Regression suite for check-pr-type.py.
#
# The check is advisory and never fails a job, so a regression in it is silent by
# construction — nothing turns red, the warning simply stops appearing. These cases run
# in CI ahead of the real check so that silence stays meaningful.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
checker="$script_dir/check-pr-type.py"
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

pass=0
fail=0

# run <warn|quiet> <title> <paths...>
run() {
	want=$1
	title=$2
	shift 2
	out=$(printf '%s\n' "$@" | CLIFF_CONFIG="$repo_root/cliff.toml" python3 "$checker" "$title")
	case "$out" in
	*'::warning'*) got=warn ;;
	*) got=quiet ;;
	esac
	if [ "$got" = "$want" ]; then
		pass=$((pass + 1))
	else
		fail=$((fail + 1))
		printf 'FAIL  want %s, got %s:  %s  [%s]\n' "$want" "$got" "$title" "$*" >&2
	fi
}

# Skipped type + source change: the failure mode this exists to catch.
run warn 'chore: tidy things up' 'crates/crustyview-core/src/lib.rs'
run warn 'chore(core): bump crustywad' 'crates/crustyview-core/src/error.rs'
run warn 'ci: adjust a job' 'crates/crustyview-web/src/wad_document.rs'
run warn 'build: rework the bundle' 'web/src/App.svelte'
run warn 'chore!: breaking cleanup' 'web/src/lib/stores/wad.ts'
run warn 'chore: nested paths count' 'crates/crustyview-core/src/nested/deep.rs'
# `test:` is not skipped, so test-only work under a skipped title is dropped too.
run warn 'chore(web): add a store test' 'web/src/lib/stores/open.test.ts'
run warn 'chore: add an integration test' 'crates/crustyview-core/tests/wad_sweep.rs'
# Mixed diff: one source file among many is enough.
run warn 'chore: mixed diff' 'README.md' 'Cargo.toml' 'web/src/App.svelte'

# Non-skipped types are none of this check's business, whatever they touch.
run quiet 'feat: add sector overlay' 'crates/crustyview-core/src/map2d.rs'
run quiet 'fix: correct off-by-one' 'web/src/lib/map.ts'
run quiet 'docs: explain the contract' 'crates/crustyview-core/src/lib.rs'
run quiet 'test: cover the blockmap arm' 'crates/crustyview-core/src/probe.rs'
run quiet 'refactor: split summary' 'crates/crustyview-core/src/summary.rs'

# Skipped type, but nothing user-facing changed — the true chore.
run quiet 'chore: bump a dev dependency' 'Cargo.toml' 'Cargo.lock'
run quiet 'ci: add a workflow' '.github/workflows/ci.yml'
run quiet 'build: adjust deny config' 'deny.toml'
run quiet 'chore: update the readme' 'README.md' 'CLAUDE.md'
run quiet 'chore: no files at all' ''

# Prefix matching must be anchored on a path boundary, not a substring.
run quiet 'chore: not web/src' 'websrc/App.svelte'
run quiet 'chore: not a src dir' 'crates/crustyview-core/srcx/lib.rs'
run quiet 'chore: docs beside src' 'crates/crustyview-core/README.md'

# A malformed title is check-conventional-subject.py's job, not this one.
run quiet 'Chore: capitalized' 'crates/crustyview-core/src/lib.rs'
run quiet 'no type at all' 'crates/crustyview-core/src/lib.rs'

printf '%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
