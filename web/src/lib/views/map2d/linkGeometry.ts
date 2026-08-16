import { pointVisible, type Rect } from './cull';
import type { TeleportLink } from './teleportArcs';

/** Teleport link treatment (#66). Links are an *annotation about* the map
 *  rather than part of it, so they are drawn subordinate to the source lines
 *  they accompany: thinner, softer, finely dotted. Drawn straight and at
 *  overlay weight they were indistinguishable from walls — the problem was
 *  never how many there are (DOOM and DOOM2 top out at 17-18 per map), it
 *  was that nothing separated annotation from geometry. */
export const LINK_DASH = [2, 3];
export const LINK_WIDTH = 1;
export const LINK_ALPHA = 0.6;
/** Endpoint marks are opaque enough to read against the dotted stroke. */
export const LINK_MARK_ALPHA = 0.9;
/** Perpendicular bow at the midpoint, as a fraction of the chord and capped
 *  in screen pixels. Nothing in a Doom map is curved, so an arc can never be
 *  mistaken for a wall — and where several links share a destination (E3M5
 *  runs 17 into 4 landings) arcs fan apart instead of stacking. */
export const LINK_BOW_RATIO = 0.18;
export const LINK_BOW_MAX = 42;
/** A ring anchors the source end, which otherwise starts inside the pad's
 *  own lines; the arrowhead anchors the destination, which otherwise ends on
 *  bare floor. Both ends looked like mistakes without them. */
export const LINK_RING_RADIUS = 3;
export const LINK_ARROW_SIZE = 7;
/** Half-angle of the arrowhead's barbs, in radians. */
export const LINK_ARROW_SPREAD = 0.42;
/** Pad for the link pass, which culls on ENDPOINTS rather than on the chord
 *  (#162) — so this covers how far ink reaches from an endpoint that sits just
 *  outside the view. The ring (`LINK_RING_RADIUS`) and the arrowhead
 *  (`LINK_ARROW_SIZE`) are drawn AT the endpoints; `LINK_BOW_MAX` is added on
 *  top even though the bow displaces the arc's MIDDLE rather than its ends,
 *  because an arc leaving a just-off-screen endpoint curves back toward the
 *  view before it exits. Summing all three is deliberately conservative: they
 *  never all extend the same way. An over-inclusive rect costs a few extra
 *  draws; an under-inclusive one deletes visible ink. */
export const LINK_CULL_PAD_PX = LINK_BOW_MAX + LINK_ARROW_SIZE + LINK_RING_RADIUS;

/** The quadratic control point that bows a link perpendicular to its chord. */
export function linkControlPoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // A zero-length link (source and destination resolve to the same point) has
  // no perpendicular; bow it by nothing rather than dividing by zero.
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(len * LINK_BOW_RATIO, LINK_BOW_MAX);
  return {
    x: (from.x + to.x) / 2 - (dy / len) * bow,
    y: (from.y + to.y) / 2 + (dx / len) * bow,
  };
}

/** The two barb vertices of a filled arrowhead at `tip`, aimed away from `tail`. */
export function arrowHeadPoints(
  tip: { x: number; y: number },
  tail: { x: number; y: number },
): [{ x: number; y: number }, { x: number; y: number }] {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const barb = (spread: number) => ({
    x: tip.x - LINK_ARROW_SIZE * Math.cos(angle + spread),
    y: tip.y - LINK_ARROW_SIZE * Math.sin(angle + spread),
  });
  return [barb(-LINK_ARROW_SPREAD), barb(LINK_ARROW_SPREAD)];
}

// Culled on the ENDPOINTS, not on whether the chord crosses the view —
// deliberately unlike every other pass, which uses `segmentVisible`'s
// trivial reject (#153). A link's chord spans much of the map, so its ends
// sit outside on OPPOSITE edges, which is precisely the case trivial reject
// is built to keep; under that rule links are effectively uncullable and
// high zoom costs MORE than fit, because each surviving arc gets longer on
// screen. Measured on Eviternity II MAP26 (1,668 links) against MAP33
// (118 links, near-identical line count): 285 ms against 12 ms at 8x.
//
// The different rule is safe because a link is an annotation about a pair
// of places rather than map geometry. Dropping a wall that crosses the view
// destroys structure the reader needs; dropping an arc whose two ends are
// both off screen removes something that says nothing about where it goes
// or where it came from (#162).
/** The endpoint-cull rule (#162) — see the rationale block above. */
export function visibleLinks(
  links: readonly TeleportLink[],
  view: Rect,
): readonly TeleportLink[] {
  const kept = links.filter(
    (link) =>
      pointVisible(view, link.from[0], link.from[1]) ||
      pointVisible(view, link.to[0], link.to[1]),
  );
  // Identity when nothing dropped, mirroring selectArcs' no-copy contract on
  // the common path.
  return kept.length === links.length ? links : kept;
}
