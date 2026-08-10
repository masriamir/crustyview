#!/usr/bin/env python3
"""Warn when a skipped-type PR title ships a change the changelog will never mention.

`cliff.toml` marks some Conventional Commit types `skip = true`, and PRs squash-merge,
so the PR title is the only commit git-cliff ever parses. A PR shipping user-visible
work under one of those types is therefore dropped from `CHANGELOG.md` *and* skips the
version bump, with nothing to report it. The release comes out green, well-formed, and
wrong (#96).

The title's *form* is already checked by `check-conventional-subject.py`, but form is
not the problem here: `chore(map): add sector overlay` is perfectly well-formed. Whether
the type is the *right* one is a judgement about what the change is, so this can only be
a heuristic — a genuine chore may legitimately touch source (a dependency bump, a
rename). It therefore warns and never fails. Replayed over the 38 commits on `main` when
it was written, it fires 3 times, twice on a title that was arguably wrong.

The skipped types are read from `cliff.toml` rather than hardcoded, so this cannot drift
away from what git-cliff actually does.

Usage:  check-pr-type.py <pr-title>  < <newline-separated changed paths>
"""

import os
import re
import sys
import tomllib

# Paths whose contents ship to a user, so a change here is unlikely to be a pure chore.
# `web/src/` sweeps in `*.test.ts`, and `crates/*/tests/` is its Rust counterpart —
# both belong to `test:`, which is *not* a skipped type, so a test-only PR titled
# `chore:` is dropped from the changelog just the same.
SOURCE_PATTERNS = (
    re.compile(r"^crates/[^/]+/src/"),
    re.compile(r"^crates/[^/]+/tests/"),
    re.compile(r"^web/src/"),
)

# `{ message = "^chore", skip = true }` — the type sits inside the anchored regex, in
# either `^chore` or `^(chore|ci)` form.
PARSER_TYPES = re.compile(r"\^\(?([a-z|]+)\)?")


def skipped_types(cliff_path):
    """Types git-cliff drops from the changelog, read from its own config."""
    with open(cliff_path, "rb") as handle:
        config = tomllib.load(handle)

    types = []
    for parser in config["git"]["commit_parsers"]:
        if not parser.get("skip"):
            continue
        match = PARSER_TYPES.match(parser.get("message", ""))
        if match:
            types.extend(match.group(1).split("|"))

    if not types:
        # A cliff.toml with no skipped types would make this check silently vacuous.
        raise SystemExit(f"{cliff_path}: no commit_parsers carry skip = true")
    return sorted(set(types))


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: check-pr-type.py <pr-title>  < <changed paths>")

    title = sys.argv[1]
    cliff_path = os.environ.get("CLIFF_CONFIG", "cliff.toml")
    skipped = skipped_types(cliff_path)

    match = re.match(r"^([a-z]+)", title)
    commit_type = match.group(1) if match else ""
    if commit_type not in skipped:
        return 0

    paths = [line.strip() for line in sys.stdin if line.strip()]
    hits = [p for p in paths if any(rx.match(p) for rx in SOURCE_PATTERNS)]
    if not hits:
        return 0

    print(
        f"::warning title=Check the PR type::'{commit_type}:' is skipped by cliff.toml, "
        f"so this PR will not appear in CHANGELOG.md and will not bump the version — "
        f"but it changes {len(hits)} source file(s). Confirm the type is right."
    )

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as summary:
            summary.write(
                f"### Check the PR type\n\n"
                f"`{title}`\n\n"
                f"`{commit_type}:` is `skip = true` in `cliff.toml`. Under squash-merge "
                f"this PR contributes **no changelog entry and no version bump**, yet it "
                f"changes source:\n\n"
            )
            for path in hits:
                summary.write(f"- `{path}`\n")
            summary.write(
                "\nIf that is intended (a dependency bump, a rename), nothing to do — "
                "this check never fails. If the change is user-visible, retitle the PR "
                "before merging: the title is the only commit message `main` keeps.\n"
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
