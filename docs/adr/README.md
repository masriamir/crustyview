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
- [ADR-0004](0004-versioning-and-release-policy.md) — Versioning and release
  policy: single workspace version, git-cliff over release-plz
- [ADR-0005](0005-scale-keyed-render-cache-for-the-2d-map.md) — Cache the 2D map
  in a scale-keyed bitmap and blit it, rather than drawing less or moving to a GPU
- [ADR-0006](0006-webgl2-2d-renderer-succession.md) — Keep the 2D map on canvas 2D,
  with a measured WebGL2 renderer recorded as its successor (spike #157; amends
  ADR-0002's GPU line) (successor shipped via #175 — WebGL2 is the default since
  #178; canvas 2D is the fallback)
- [ADR-0007](0007-wcag-22-aa-accessibility-standard.md) — Adopt WCAG 2.2 AA as the
  accessibility design target, with a canvas-equivalence policy and tiered
  enforcement (spike #51)
