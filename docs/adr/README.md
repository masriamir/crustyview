# Architecture Decision Records

Significant, hard-to-reverse decisions for `crustyview` are recorded here as
ADRs — one file per decision, capturing its context, the options weighed, and
the consequences. `crustyview` is an application, so this is deliberately
lightweight: no published guide and no docs-sync automation, just durable
records (mirroring `crustywad`'s ADR *structure* without its library-publishing
ceremony).

## Process

1. Copy [`0000-adr-template.md`](0000-adr-template.md) to a new
   `NNNN-short-title.md`, where `NNNN` is the next zero-padded sequence number.
2. Fill in the sections; start the ADR in `Proposed`.
3. Attach it to the PR that makes the decision and discuss there.
4. Once agreed, set the status to `Accepted` and merge.
5. If a later decision overrides this one, set the status to
   `Superseded by ADR-NNNN` and link forward.

Record a decision when it is architectural, cross-cutting, or costly to reverse
(how we consume `crustywad`, the UI framework, per-format handling, …). Routine
choices don't need an ADR.

## Status values

- `Proposed` — under discussion
- `Accepted` — agreed and in force
- `Rejected` — considered and declined
- `Deprecated` — no longer relevant
- `Superseded by ADR-NNNN` — replaced by a newer decision

## Index

- [ADR-0001](0001-consume-crustywad-via-pinned-wasm.md) — Consume `crustywad` as
  a pinned-release Rust→WASM dependency (spike: GO)
- [ADR-0002](0002-hybrid-portable-core-svelte-shell.md) — Hybrid UI: a
  portable Rust/`wgpu` core behind a Svelte + TypeScript web shell
- [ADR-0003](0003-viewer-ui-ux-sidebar-shell.md) — Viewer UI/UX: sidebar
  shell, state-driven navigation, tokened light/dark theming, mobile-capable
