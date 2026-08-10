#!/usr/bin/env python3
"""Validate a Conventional Commits subject line, read from stdin.

Single source of truth for two gates that must agree but see different strings:

  * lefthook's `commit-msg` hook, which checks each commit written on a branch;
  * the `pr-title` CI workflow, which checks the PR title.

Only the second one reaches `main`. PRs squash-merge, so the PR title becomes the
sole commit message on `main` and is what git-cliff parses for changelog inclusion,
section, and version bump (ADR-0004 policy item 5). Keeping one regex here means a
title that satisfies CI cannot be one lefthook would have rejected, or vice versa.

Reads the subject on stdin and considers only its first line, so it can be fed a
commit-message file (`head -n 1`) or a PR title alike.
"""

import re
import sys

TYPES = (
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "perf",
    "refactor",
    "revert",
    "style",
    "test",
)

# Mirrors cliff.toml's `conventional_commits = true` parsing: lowercase type, an
# optional parenthesized scope, an optional `!` breaking marker, then `: ` and a
# non-empty description.
PATTERN = re.compile(
    rf"^({'|'.join(TYPES)})(\([a-z0-9._/-]+\))?!?: .+",
)


def main() -> int:
    subject = sys.stdin.readline().rstrip("\n")
    if PATTERN.match(subject):
        return 0

    print(f"Not a Conventional Commits subject: {subject!r}", file=sys.stderr)
    print(
        "Expected <type>[(scope)][!]: <description>, e.g. "
        "feat(parser): add wad reader",
        file=sys.stderr,
    )
    print(f"Valid types: {' '.join(TYPES)}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
