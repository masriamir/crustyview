import type { Map2d } from '../../format';

/**
 * How many teleport link arcs may draw at once (#154).
 *
 * A ladder rather than a free number, mirroring `GRID_SIZES`: the `,` and `.`
 * keys step it, and a set of known values is what makes the stored value
 * validatable.
 *
 * `'all'` is a string rather than `Infinity` because the value is persisted as
 * JSON, where `Infinity` serializes to `null`. It is kept on the ladder even
 * though it is the slow, unreadable setting — it is the behavior that shipped
 * before this change, and removing it silently would be worse than offering it
 * with a label that says what it costs.
 */
export const TELEPORT_ARC_CAPS = [25, 50, 100, 200, 400, 'all'] as const;
export type TeleportArcCap = (typeof TELEPORT_ARC_CAPS)[number];

/**
 * Chosen by looking, not by reasoning: rendered side by side at fit zoom on
 * Eviternity II MAP26, 25 already shows the map's dominant teleport artery,
 * 100 shows its corridor structure, 400 is thickening into a hairball and
 * 1,668 is unreadable. Only 8 of 164 maps in the local WAD set exceed 500
 * links, so this default leaves roughly 92% of maps untouched.
 */
export const DEFAULT_TELEPORT_ARC_CAP: TeleportArcCap = 100;

/** The next rung up or down, clamped at both ends. */
export function stepArcCap(current: TeleportArcCap, direction: -1 | 1): TeleportArcCap {
  const at = TELEPORT_ARC_CAPS.indexOf(current);
  const next = Math.min(Math.max(at + direction, 0), TELEPORT_ARC_CAPS.length - 1);
  return TELEPORT_ARC_CAPS[next];
}

/** Set-membership validator for stored preference values. */
export function isTeleportArcCap(value: unknown): value is TeleportArcCap {
  return (TELEPORT_ARC_CAPS as readonly unknown[]).includes(value);
}

export type TeleportLink = NonNullable<Map2d['links']>[number];

function chordLength(link: TeleportLink): number {
  return Math.hypot(link.to[0] - link.from[0], link.to[1] - link.from[1]);
}

/**
 * The arcs to draw, longest chord first, from an **already culled** candidate
 * list.
 *
 * Taking candidates rather than the whole map is what fixes the order of
 * operations structurally: cull by endpoint first, then cap what survived. Cap
 * first and the N longest links in the *map* are chosen, nearly all of which
 * are off screen at high zoom — so zooming in would reveal nothing instead of
 * progressively revealing local links.
 *
 * Longest-first because a long link defines the map's topology by connecting
 * distant regions, while a short one is a local pad that draws as a dot at fit
 * zoom and appears anyway once you zoom to it.
 *
 * Returns the input array itself when nothing is dropped, so the common case
 * costs neither a sort nor a copy.
 */
export function selectArcs(
  candidates: readonly TeleportLink[],
  cap: number | 'all',
): readonly TeleportLink[] {
  if (cap === 'all' || candidates.length <= cap) return candidates;
  // `sort` is stable, so equal-length chords keep their relative order and the
  // same N come back on every call — required, because the cached tile and a
  // direct render must agree.
  return [...candidates].sort((a, b) => chordLength(b) - chordLength(a)).slice(0, cap);
}

/**
 * The button's visible value: the cap, plus the map's total when the cap is
 * actually biting.
 *
 * Deliberately a function of the cap and the map's link count, NOT of how many
 * survived culling at the current view. A view-dependent readout would change
 * while panning and would need to be threaded back from the component — which
 * is exactly the shape that produced #128's stale grid label.
 */
export function arcCapLabel(cap: TeleportArcCap, total: number): string {
  if (total === 0) return 'none';
  if (cap === 'all') return 'all';
  return total > cap ? `${cap} of ${total.toLocaleString()}` : `${cap}`;
}

/**
 * The button's accessible name. States the same value in words: the visible
 * label's `·` separator and thousands separator would otherwise be spoken as
 * punctuation, making the announcement worse than the label (CLAUDE.md, #74).
 * Contains the visible label "Links", as WCAG 2.5.3 requires.
 */
export function arcCapName(cap: TeleportArcCap, total: number): string {
  if (total === 0) return 'Show teleport links, none on this map';
  if (cap === 'all') return 'Show teleport links, all drawn';
  return total > cap
    ? `Show teleport links, ${cap} of ${total} drawn`
    : `Show teleport links, cap ${cap}`;
}
