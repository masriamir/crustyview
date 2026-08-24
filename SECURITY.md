# Security Policy

## Supported versions

This project is pre-1.0.0. Only the latest tagged release is supported: security fixes land on `main` and ship in the next release.

## Reporting a vulnerability

Please use [private vulnerability reporting](https://github.com/masriamir/crustyview/security/advisories/new) instead of filing a public issue for a suspected vulnerability.

## Security posture

crustyview runs entirely in the browser. A WAD is opened from the local file system and read client-side (`file.arrayBuffer()`); nothing is uploaded, and the application makes no network requests beyond loading its own static assets — there is no server component.

Parsing of untrusted WAD input is delegated to [crustywad](https://github.com/masriamir/crustywad), consumed as a pinned crates.io release; its hardening against malformed input is documented there in [ADR-0016, *Parser hardening policy*](https://github.com/masriamir/crustywad/blob/main/docs/adr/0016-parser-hardening-policy.md). The crustyview crates themselves contain no `unsafe` code.

Supply chain: every third-party GitHub Action is pinned to a full commit SHA, and `cargo deny check` runs in CI as the required `security-deny` check.
