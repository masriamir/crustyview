# ADR-0007: Adopt WCAG 2.2 AA, with a canvas-equivalence policy and tiered enforcement

- **Status:** Accepted
- **Date:** 2026-08-18
- **Deciders:** Amir Masri
- **Tracking issue / PR:** [#51](https://github.com/masriamir/crustyview/issues/51)

## Context and problem statement

crustyview has designed with accessibility in mind since #35 gave the 2D map canvas a real
treatment — a keyboard-operable `role="application"` widget with live-region announcements —
and the E2E suite locates almost everything by ARIA role and accessible name. What it has
never had is an adopted standard: no named conformance target, no baseline audit, and no
enforcement beyond review discipline. That discipline has been load-bearing — the a11y defect
history (#125, #127, #128, #131) was caught entirely by review, and #74's audit produced the
label-in-name analysis now recorded in AGENTS.md — but discipline is not a standard, and the
3D viewport (epic #8) will pose every canvas question again, harder. Spike #51 asked: which
standard and level, what "equivalent experience" means for a canvas-rendered map, what the
app-shell owes in a router-less UI, and how any of it is enforced.

## Decision drivers

- **The core content is a picture.** The map is a rendered visualization of user-supplied WAD
  data; a useful standard must say what the textual and keyboard equivalent of that picture
  is, not just score the DOM around it.
- **The shipped surface is already close.** The #51 baseline audit (below) found exactly one
  strict AA failure across thirteen app states — adopting a standard mostly names what the
  app already practices, so the cost is process, not rework.
- **Review is the only net today.** Every past a11y defect was caught by a person. Where
  automation exists (axe), not running it is an unforced gap — #61 was filed for exactly
  this and waits on this ADR for its ruleset and posture.
- **State-driven navigation forfeits free platform signals** (ADR-0003: no URL router). Page
  loads, titles, and focus landmarks that a router would provide must be explicit policy or
  they silently don't exist — the audit found precisely this family of gaps.
- **The 3D viewport must inherit a policy, not a debate.** Epic #8's viewport should land
  against equivalence rules that predate it, the way #157's renderer landed against
  ADR-0002's amended boundary.
- **This is a hobby project.** No legal obligation applies (the regulatory context below is
  context only), so the target must be honest about effort: a level the app can actually
  hold, enforced cheaply.

## Considered options

1. No formal standard — continue per-feature judgment and review discipline.
2. WCAG 2.1 Level AA — the version current regulation cites.
3. **WCAG 2.2 Level AA as the design target.** *(Chosen.)*
4. WCAG 3.0 (draft) — adopt the successor early.

## Decision outcome

Chosen option: **3 — WCAG 2.2 Level AA as the design target.** WCAG 2.2 is the current W3C
Recommendation (first published October 2023, last revised December 2024); 2.2 AA is the
conventional modern target, a superset of the 2.1 AA that regulation cites (2.2 also removes
4.1.1 Parsing), and its six new A/AA criteria — focus not obscured, dragging alternatives,
24px minimum target size, consistent help, redundant entry, accessible authentication — are
exactly the categories a pannable, draggable map app should be measured against. "Design target" means:
new UI is designed against 2.2 AA, violations found in shipped UI are defects (`accessibility`
label), and the claim is a working target rather than a formal conformance statement — the
app renders arbitrary third-party WAD content, so a blanket conformance claim would be
unkeepable, while a target scoped to the app's own UI is testable and honest.

Level AA, not AAA: the map is an inherently visual, color-coded tool; AAA criteria such as
7:1 contrast (1.4.6) and no-timing/no-motion absolutes are impractical for it and AAA is not
recommended as a general policy even by WCAG itself. AAA criteria the app already meets stay
met as facts, not obligations — reduced-motion handling (2.3.3) is already shipped
(`app.css` zeroes `--transition`; the loading overlay collapses its reveal).

### Regulatory context (context, not obligation)

The legal anchors confirm AA as the conventional level and 2.2 as the forward-looking
version: the US ADA Title II rule (2024) requires WCAG **2.1** AA of public entities, with
compliance dates extended in April 2026 to 2027/2028, and the EU's EN 301 549 v3.2.1 (the
European Accessibility Act's harmonized standard; the Act's obligations run from June 2025)
also incorporates **2.1** AA — its v4.1.1 update, planned for 2026, moves to 2.2 AA. Targeting 2.2 AA means meeting both citations along the way; nothing about this
hobby viewer is in scope for either regime.

### The baseline audit (2026-08-18, v0.3.0)

Evidence for this decision, and the punch list it produced. Method: axe-core against the
built app across thirteen states (desktop and mobile viewports × light and dark themes ×
empty shell, overview, map, textures, lumps, map list, and load-error states), a manual
contrast probe of every node axe marked "incomplete", a scripted full keyboard tab-cycle of
the richest view, and a code survey of every ARIA, focus, keyboard, and theming site.

**What already holds:** the full tab cycle reaches every control with a visible focus
indicator and no traps; the canvas is a named, keyboard-operable `application` widget with a
persistent instructions description; six live regions cover load state, grid, arc cap, map
switches, and errors with debounce discipline (#127/#131); chips stay focusable when
zero-count via `aria-disabled`; touch targets hold 44px on compact layouts (2.5.8's 24px
minimum is comfortably met); reduced motion is honored; mobile and dark theme run axe-clean.

**The strict failures and gaps, filed as issues:**

| Issue | Gap | WCAG SC |
|---|---|---|
| #183 | Light theme's selected nav item: accent on tint at 4.05–4.43:1 | 1.4.3 (the audit's only strict AA failure) |
| #184 | No focus management on view changes, `inert`/disabled episodes; no skip link | 2.4.3, 2.4.1 |
| #185 | Compact layout drops the only shell live region and the map-stats text | 4.1.3, 1.1.1 |
| #186 | `document.title` never reflects WAD/section/map | 2.4.2 |
| #187 | Zoom never announced; cursor position has no keyboard/AT path | 4.1.3, 2.1.1 |
| #188 | Semantics batch: duplicate nav names, unlabeled file inputs, div drop zone, homeless build span | 4.1.2, 1.3.1 |
| #189 | VoiceOver smoke pass — the audit leg that needs a human | — |
| #181 | (pre-existing) renderer canvas swap drops focus, unannounced | 2.4.3, 4.1.3 |

### Canvas equivalence — what the standard means for the map (2D now, 3D before it exists)

WCAG's success criteria evaluate DOM; a canvas is one opaque element to them. The policy that
makes "equivalent experience" concrete here, distilled from what #35 onward already
practices:

1. **Every map interaction has a keyboard equivalent.** Pan (arrows), zoom (`+`/`-`), fit
   (`0`), grid (`[`/`]`), arc cap (`,`/`.`) all hold today; anything new arrives with its key.
2. **Every state change either updates an accessible name or is announced.** The grid and
   arc-cap announcers are the pattern (debounced where changes stream, immediate on
   keypress); zoom is the standing violation (#187).
3. **Quantitative content exists as text.** The stats readout is the map's textual
   equivalent under 1.1.1 — which is why the compact layout dropping it is a defect (#185),
   not a styling choice.
4. **Non-text contrast (1.4.11) applies to the themed palettes' functional inks** — the
   lines and markers a user must distinguish to read the map — at 3:1 against the map
   background (measured today: walls 5.24:1 light / 6.62:1 dark; two-sided lines 3.29:1
   light). Two named exceptions: the **grid**, an optional user-summoned aid whose state is
   fully announced textually, may sit below 3:1; and the **classic palette** is a faithful
   reproduction of the original automap that the user explicitly selects, like a theme — the
   themed palettes are the conforming default path.
5. **The 3D viewport inherits all of the above.** It ships as an enhancement alongside the
   2D map and stats, never as the only path to information; it arrives keyboard-operable and
   announced under the same rules, or it does not ship as a default.

### The shell policy — what a router-less app owes explicitly

- **Focus is managed, not lucky.** A view change that unmounts the focused control moves
  focus to the new view's region; focus displaced by `inert` or mid-load `disabled` episodes
  is restored; content is reachable without traversing the full map list (#184). The
  renderer canvas swap gets **both** halves of #181's question: refocus the fresh canvas
  *and* announce the backend change through the existing status pattern — a swap the user
  cannot perceive is worse than either half alone.
- **`document.title` mirrors navigation state** (#186) — the router-less substitute for
  page-load announcements.
- **Live regions exist at every width.** Hiding a visual bar is styling; unmounting its
  semantics is a defect (#185).
- **Label in Name (2.5.3), as recorded in AGENTS.md:** a control's accessible name contains
  its visible label; a value readout inside the visible label is a value, not label text,
  and the name restates it in words rather than speaking punctuation (`Grid · 32→128` →
  "Show grid, 32, drawn as 128"). This ADR is now the durable home of that policy;
  AGENTS.md's UI-conventions entry stays as the worked example.

### Enforcement — tiered, cheapest tier first

1. **axe in E2E (#61):** `@axe-core/playwright` assertions in the Playwright suite at both
   viewports and both themes, over the audit's app states. Ruleset: the WCAG A/AA tags
   through 2.2 (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` — axe-core documents
   no separate `wcag22a` tag); best-practice rules stay advisory. Posture follows the repo's own precedent
   (`web-browser-test`, #140): land inside the `web-e2e` smoke job first, promote to a
   required check once it has run green for a stretch. Sequencing: #183 must merge first or
   carry a documented temporary exclusion, since the light-theme states fail today.
   Automated checks catch only a minority of WCAG failures — this tier is a floor, not the
   standard.
2. **Contrast is asserted, not remembered:** the browser tier gains token-pair ratio
   assertions (the existing `theme-tokens` suite is the natural home), so a theme edit that
   sinks below 4.5:1 text / 3:1 non-text fails a test instead of waiting for the next audit.
   Lands with #183's fix.
3. **The browser tier keeps owning timing semantics** — announcement debounce, cleanup, and
   lifecycle wiring, per the Testing section's worked examples. axe cannot see these.
4. **The feature-request template asks the question:** an optional "Accessibility" field
   prompting for the keyboard path, announcements, and contrast story of proposed UI —
   shipped with this ADR.
5. **An AGENTS.md design principle** makes the target ambient for every future session —
   shipped with this ADR.
6. **Human passes at a cadence:** a VoiceOver smoke walk (#189 is the first) repeated per
   release or when shell semantics change. Screen-reader experience is the one thing no
   tier above observes.

### Consequences

- Good, because the target now has a name, a baseline, and a punch list — "designed with
  accessibility in mind" becomes checkable, and the next audit diffs against this one.
- Good, because the 3D viewport's accessibility question is answered before its design
  starts, in the direction the 2D map already proved out.
- Good, because the enforcement tiers automate what automation can see and are explicit
  about what it cannot — no green-checkmark illusion of the kind the Testing section warns
  about.
- Bad, because a design target invites drift if the punch list stalls: the standard is
  adopted the day #183–#188 are fixed and #61 gates, not the day this merges.
- Bad, because WCAG 2.2's evaluation of a canvas application is genuinely partial — the
  equivalence policy above is this project's own interpretation, and a screen-reader user's
  actual experience needs #189-style human passes to keep it honest.
- Neutral, because WCAG 3.0 will eventually supersede 2.x; nothing here resists that — the
  policy sections translate, and the revisit trigger below names it.

## Pros and cons of the options

### 1 — No formal standard

- Good, because it is free, and review discipline has genuinely worked so far.
- Bad, because it does not scale past one reviewer's attention, gives the 3D viewport
  nothing to inherit, and makes "accessible" an opinion rather than a diff — the audit's
  gaps existed precisely where discipline had no checklist.

### 2 — WCAG 2.1 AA

- Good, because it is the version regulation currently cites, and every 2.1 criterion is in
  2.2 anyway.
- Bad, because it is two revisions behind for no saving — the 2.2 additions (focus
  appearance, dragging alternatives, target size) are the criteria most relevant to a
  drag-and-zoom map, and the app already meets the ones the audit measured.

### 3 — WCAG 2.2 AA (chosen)

- Good, because it is the current Recommendation, a superset of what regulation cites, and
  its new criteria map directly onto this app's interaction model.
- Bad, because axe rule coverage for the newest criteria is thinner, so more of 2.2's edge
  rests on the manual tiers.

### 4 — WCAG 3.0 (draft)

- Good, because its outcome-based scoring handles non-DOM content like canvas better in
  principle.
- Bad, because it remains a W3C draft with no stable conformance model — untargetable in
  practice; adopting it now would mean chasing a moving document.

## More information

The full audit evidence — the axe state matrix, the manual contrast probe values, and the
tab-cycle capture — is recorded in the spike assessment on
[#51](https://github.com/masriamir/crustyview/issues/51). Related: ADR-0003 (the shell and
navigation model this ADR adds policy to), AGENTS.md's UI-conventions section (the 2.5.3
worked example, now backed by this ADR), #61 (the axe tier this ADR scopes), #181 and
#183–#189 (the punch list).

Revisit when WCAG 2.3 or 3.0 reaches Recommendation, when EN 301 549 formally moves to 2.2
(context only, but it signals the conventional target shifting), or at the 3D viewport ADR,
which must translate the equivalence policy to the viewport's actual design.
