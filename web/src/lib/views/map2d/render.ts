import type { Map2d } from '../../format';
import { mapPrefs, type MapStyle } from '../../stores/mapPrefs.svelte';
import { mapToScreen, type Transform } from './transform';
import {
  ARROW_CATEGORIES,
  ARROW_CATEGORY_ORDER,
  CATEGORIES,
  CLASSIC_THING_COLORS,
  categoryOf,
  type ThingCategory,
} from './things';
import {
  CLASSIC_LINE_SECTOR_DAMAGE,
  CLASSIC_LINE_SECTOR_SECRET,
  CLASSIC_LINE_TELEPORT,
} from './lines';
import { pointVisible, segmentVisible, viewportRect } from './cull';

type LineKind = Map2d['lines'][number]['kind'];

/** Every color one draw needs, resolved once per draw. */
export interface Palette {
  bg: string;
  grid: string;
  wall: string;
  twoSided: string;
  secret: string;
  lineTeleport: string;
  lineSectorSecret: string;
  lineSectorDamage: string;
  things: Record<ThingCategory, string>;
  player: string;
}

/**
 * Classic Doom automap colors. Deliberately a constant rather than tokens: the
 * classic style is theme-independent — it looks the same in light and dark.
 */
const CLASSIC: Palette = {
  bg: '#0a0a0a',
  grid: '#2c2c2e',
  wall: '#ff3b30',
  twoSided: '#8e8e93',
  secret: '#ffd60a',
  lineTeleport: CLASSIC_LINE_TELEPORT,
  lineSectorSecret: CLASSIC_LINE_SECTOR_SECRET,
  lineSectorDamage: CLASSIC_LINE_SECTOR_DAMAGE,
  things: CLASSIC_THING_COLORS,
  player: '#34c759',
};

/** Fixed CSS-pixel sizes — screen-space glyphs, so they don't scale with zoom. */
const THING_PX = 3;
const PLAYER_ARROW_PX = 10;
/** Start markers below player 1, so the flagship arrow stays dominant where
 *  a level clusters all four starts in one room (#72). Sized independently —
 *  they were tuned separately and may diverge — and both landed on 7. */
const COOP_ARROW_PX = 7;
const DEATHMATCH_ARROW_PX = 7;
/** Arrow size per `ARROW_CATEGORY_ORDER` member. Keyed off that array's
 *  element type, so adding a category there fails to compile here until it
 *  is given a size (things.ts). */
const ARROW_SIZES: Record<(typeof ARROW_CATEGORY_ORDER)[number], number> = {
  deathmatch: DEATHMATCH_ARROW_PX,
  coop: COOP_ARROW_PX,
};
const PLAYER_THING_TYPE = 1;
/** Back-to-front, so the rarer kinds stay legible where lines overlap. */
const KIND_ORDER = ['two_sided', 'one_sided', 'secret'] as const satisfies readonly LineKind[];
const KIND_WIDTH: Record<LineKind, number> = { two_sided: 1, one_sided: 2, secret: 1.5 };
/** Dashed overlay strokes above the base kind colors. Teleport keeps its
 *  own rhythm; the two sector overlays share [4,4] with the damage pass
 *  phase-shifted, so a line bordering both a secret and a damaging sector
 *  interleaves the two colors instead of one hiding the other. */
const TELEPORT_DASH = [6, 4];
const SECTOR_DASH = [4, 4];
const OVERLAY_WIDTH = 2;
const DAMAGE_DASH_OFFSET = 4;
/** Cull padding in screen px. Each pad is derived from the constant(s) that
 *  size the ink it covers — the whole stroke width or glyph size, not a
 *  hand-computed half-extent — so a pad can never fall out of sync with the
 *  size it is meant to cover the way a hand-computed literal can. */
const LINE_CULL_PAD_PX = Math.max(...Object.values(KIND_WIDTH), OVERLAY_WIDTH);
/** `THING_PX` is drawn centered, so a marker's own reach is half of it;
 *  padding by the whole size is trivially conservative. */
const THING_CULL_PAD_PX = THING_PX;
/** A start arrow's farthest point is a barb vertex, at radius `half * 1.28`
 *  from the arrow's coordinate (barbs sit at `(-half, ±half*0.8)`; the glyph
 *  rotates arbitrarily). Padding by the full `size` clears this radius: size 7
 *  yields 4.482, size 10 (`PLAYER_ARROW_PX`) yields 6.403, both covered by
 *  this pad. `PLAYER_ARROW_PX` belongs to `drawPlayerStart`, deliberately
 *  never culled. */
const ARROW_CULL_PAD_PX = Math.max(...Object.values(ARROW_SIZES));

/** Teleport link treatment (#66). Links are an *annotation about* the map
 *  rather than part of it, so they are drawn subordinate to the source lines
 *  they accompany: thinner, softer, finely dotted. Drawn straight and at
 *  overlay weight they were indistinguishable from walls — the problem was
 *  never how many there are (DOOM and DOOM2 top out at 17-18 per map), it
 *  was that nothing separated annotation from geometry. */
const LINK_DASH = [2, 3];
const LINK_WIDTH = 1;
const LINK_ALPHA = 0.6;
/** Endpoint marks are opaque enough to read against the dotted stroke. */
const LINK_MARK_ALPHA = 0.9;
/** Perpendicular bow at the midpoint, as a fraction of the chord and capped
 *  in screen pixels. Nothing in a Doom map is curved, so an arc can never be
 *  mistaken for a wall — and where several links share a destination (E3M5
 *  runs 17 into 4 landings) arcs fan apart instead of stacking. */
const LINK_BOW_RATIO = 0.18;
const LINK_BOW_MAX = 42;
/** A ring anchors the source end, which otherwise starts inside the pad's
 *  own lines; the arrowhead anchors the destination, which otherwise ends on
 *  bare floor. Both ends looked like mistakes without them. */
const LINK_RING_RADIUS = 3;
const LINK_ARROW_SIZE = 7;
/** Half-angle of the arrowhead's barbs, in radians. */
const LINK_ARROW_SPREAD = 0.42;
/** Pad for the link pass, which culls on ENDPOINTS rather than on the chord
 *  (#162) — so this covers how far ink reaches from an endpoint that sits just
 *  outside the view. The ring (`LINK_RING_RADIUS`) and the arrowhead
 *  (`LINK_ARROW_SIZE`) are drawn AT the endpoints; `LINK_BOW_MAX` is added on
 *  top even though the bow displaces the arc's MIDDLE rather than its ends,
 *  because an arc leaving a just-off-screen endpoint curves back toward the
 *  view before it exits. Summing all three is deliberately conservative: they
 *  never all extend the same way. An over-inclusive rect costs a few extra
 *  draws; an under-inclusive one deletes visible ink. */
const LINK_CULL_PAD_PX = LINK_BOW_MAX + LINK_ARROW_SIZE + LINK_RING_RADIUS;

function token(style: CSSStyleDeclaration, property: string, fallback: string): string {
  const value = style.getPropertyValue(property).trim();
  return value === '' ? fallback : value;
}

export function resolvePalette(el: HTMLElement, mapStyle: MapStyle): Palette {
  if (mapStyle === 'classic') return CLASSIC;
  const style = getComputedStyle(el);
  return {
    bg: token(style, '--map2d-bg', CLASSIC.bg),
    grid: token(style, '--map2d-grid', CLASSIC.grid),
    wall: token(style, '--map2d-wall', CLASSIC.wall),
    twoSided: token(style, '--map2d-two-sided', CLASSIC.twoSided),
    secret: token(style, '--map2d-secret', CLASSIC.secret),
    lineTeleport: token(style, '--map2d-line-teleport', CLASSIC.lineTeleport),
    lineSectorSecret: token(style, '--map2d-line-sector-secret', CLASSIC.lineSectorSecret),
    lineSectorDamage: token(style, '--map2d-line-sector-damage', CLASSIC.lineSectorDamage),
    things: Object.fromEntries(
      CATEGORIES.map((c) => [c.id, token(style, `--map2d-thing-${c.id}`, CLASSIC_THING_COLORS[c.id])]),
    ) as Record<ThingCategory, string>,
    player: token(style, '--map2d-player', CLASSIC.player),
  };
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  t: Transform,
  width: number,
  height: number,
  color: string,
  step: number,
): void {
  // Precondition: `step` cleared `MIN_GRID_PX` at this scale — the sole caller
  // resolves it through `effectiveGridSize`, which owns the density rule (#76).
  // Invert the viewport corners: only the visible map rect needs grid lines.
  const view = viewportRect(t, width, height, 0);
  const path = new Path2D();
  for (let x = Math.ceil(view.minX / step) * step; x <= view.maxX; x += step) {
    const from = mapToScreen(t, x, view.minY);
    const to = mapToScreen(t, x, view.maxY);
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }
  for (let y = Math.ceil(view.minY / step) * step; y <= view.maxY; y += step) {
    const from = mapToScreen(t, view.minX, y);
    const to = mapToScreen(t, view.maxX, y);
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke(path);
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  colors: Palette,
): void {
  // One path per kind, filled in a single pass, so each kind strokes once
  // regardless of how the WAD interleaves them.
  const paths: Record<LineKind, Path2D> = {
    two_sided: new Path2D(),
    one_sided: new Path2D(),
    secret: new Path2D(),
  };
  const view = viewportRect(t, width, height, LINE_CULL_PAD_PX);
  for (const line of map.lines) {
    const path = paths[line.kind];
    if (!path) continue; // defensive: an unknown kind must not break the draw
    if (!segmentVisible(view, line.x1, line.y1, line.x2, line.y2)) continue;
    const from = mapToScreen(t, line.x1, line.y1);
    const to = mapToScreen(t, line.x2, line.y2);
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }
  const kindColor: Record<LineKind, string> = {
    two_sided: colors.twoSided,
    one_sided: colors.wall,
    secret: colors.secret,
  };
  for (const kind of KIND_ORDER) {
    ctx.strokeStyle = kindColor[kind];
    ctx.lineWidth = KIND_WIDTH[kind];
    ctx.stroke(paths[kind]);
  }
}

/** One dashed overlay pass above the base kind strokes. */
interface OverlayStroke {
  color: string;
  dash: number[];
  dashOffset?: number;
  marked: (line: Map2d['lines'][number]) => boolean;
}

function drawLineOverlay(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  overlay: OverlayStroke,
): void {
  const path = new Path2D();
  const view = viewportRect(t, width, height, LINE_CULL_PAD_PX);
  let any = false;
  for (const line of map.lines) {
    if (!overlay.marked(line)) continue;
    if (!segmentVisible(view, line.x1, line.y1, line.x2, line.y2)) continue;
    any = true;
    const from = mapToScreen(t, line.x1, line.y1);
    const to = mapToScreen(t, line.x2, line.y2);
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
  }
  if (!any) return;
  ctx.strokeStyle = overlay.color;
  ctx.lineWidth = OVERLAY_WIDTH;
  ctx.setLineDash(overlay.dash);
  ctx.lineDashOffset = overlay.dashOffset ?? 0;
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// Teleport source-to-destination links (#66). Same token as the source lines:
// they read as one overlay, toggled by one chip.

/** The quadratic control point that bows a link perpendicular to its chord. */
function linkControlPoint(
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

/** A filled arrowhead at `tip`, pointing away from `tail`. */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: { x: number; y: number },
  tail: { x: number; y: number },
  color: string,
): void {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  for (const spread of [-LINK_ARROW_SPREAD, LINK_ARROW_SPREAD]) {
    ctx.lineTo(
      tip.x - LINK_ARROW_SIZE * Math.cos(angle + spread),
      tip.y - LINK_ARROW_SIZE * Math.sin(angle + spread),
    );
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawTeleportLinks(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  color: string,
): void {
  if (!map.links?.length) return;
  const view = viewportRect(t, width, height, LINK_CULL_PAD_PX);
  ctx.save();
  ctx.strokeStyle = color;
  for (const link of map.links) {
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
    if (
      !pointVisible(view, link.from[0], link.from[1]) &&
      !pointVisible(view, link.to[0], link.to[1])
    ) {
      continue;
    }
    const from = mapToScreen(t, link.from[0], link.from[1]);
    const to = mapToScreen(t, link.to[0], link.to[1]);
    const control = linkControlPoint(from, to);

    const arc = new Path2D();
    arc.moveTo(from.x, from.y);
    arc.quadraticCurveTo(control.x, control.y, to.x, to.y);
    ctx.setLineDash(LINK_DASH);
    ctx.lineWidth = LINK_WIDTH;
    ctx.globalAlpha = LINK_ALPHA;
    ctx.stroke(arc);

    // Endpoint marks: solid, so they read as anchors rather than more stroke.
    ctx.setLineDash([]);
    ctx.globalAlpha = LINK_MARK_ALPHA;
    ctx.beginPath();
    ctx.arc(from.x, from.y, LINK_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    // Aimed along the curve's exit, not the chord, or the head sits skewed
    // to the stroke it terminates.
    drawArrowHead(ctx, to, control, color);
  }
  ctx.restore();
}

function drawThings(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  colors: Palette,
  game: string | null,
): void {
  // One path per visible rect category, mirroring drawLines' per-kind
  // batching; arrow categories skip this batch entirely (they need
  // per-marker rotation) and hidden categories are skipped before any path
  // work.
  const paths = new Map<ThingCategory, Path2D>();
  const half = THING_PX / 2;
  const view = viewportRect(t, width, height, THING_CULL_PAD_PX);
  for (const thing of map.things) {
    const category = categoryOf(thing.type_id, game);
    if (ARROW_CATEGORIES.has(category)) continue;
    if (!mapPrefs.isCategoryShown(category)) continue;
    if (!pointVisible(view, thing.x, thing.y)) continue;
    let path = paths.get(category);
    if (path === undefined) {
      path = new Path2D();
      paths.set(category, path);
    }
    const at = mapToScreen(t, thing.x, thing.y);
    path.rect(at.x - half, at.y - half, THING_PX, THING_PX);
  }
  // Reverse chip order: the list's top categories paint last, on top.
  for (let i = CATEGORIES.length - 1; i >= 0; i--) {
    const path = paths.get(CATEGORIES[i].id);
    if (path === undefined) continue;
    ctx.fillStyle = colors.things[CATEGORIES[i].id];
    ctx.fill(path);
  }
}

/** Co-op and deathmatch starts, as arrows sized below the player-1 marker. */
function drawMultiplayerStarts(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  colors: Palette,
  game: string | null,
): void {
  // `ARROW_CATEGORY_ORDER` carries the back-to-front paint order: deathmatch
  // first so co-op paints above it where a level puts both in one room;
  // `drawPlayerStart` then paints above both.
  const view = viewportRect(t, width, height, ARROW_CULL_PAD_PX);
  for (const category of ARROW_CATEGORY_ORDER) {
    if (!mapPrefs.isCategoryShown(category)) continue;
    const color = colors.things[category];
    const size = ARROW_SIZES[category];
    for (const thing of map.things) {
      if (categoryOf(thing.type_id, game) !== category) continue;
      if (!pointVisible(view, thing.x, thing.y)) continue;
      drawStartArrow(ctx, mapToScreen(t, thing.x, thing.y), thing.angle, size, color);
    }
  }
}

/**
 * A start marker: a filled arrow at screen position `at`, turned to face the
 * thing's angle.
 *
 * Thing angles are degrees counter-clockwise from east in map space; screen Y
 * points the other way, so the same turn is a negative canvas rotation.
 */
function drawStartArrow(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  angle: number,
  size: number,
  color: string,
): void {
  const half = size / 2;
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(-half, -half * 0.8);
  ctx.lineTo(-half * 0.4, 0);
  ctx.lineTo(-half, half * 0.8);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** The player-1 start, as an arrow pointing the way the player faces. */
function drawPlayerStart(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  color: string,
): void {
  const start = map.things.find((thing) => thing.type_id === PLAYER_THING_TYPE);
  if (!start) return;
  drawStartArrow(ctx, mapToScreen(t, start.x, start.y), start.angle, PLAYER_ARROW_PX, color);
}

/**
 * Cull padding for the cached tile: the largest reach of any pass, so ink from
 * geometry just outside the tile's map rect is still baked.
 *
 * A derived expression, never a literal — #153's rule for every pad in this
 * file. A glyph or stroke growing anywhere above updates this automatically.
 */
export const TILE_PAD_PX = Math.max(
  LINE_CULL_PAD_PX,
  THING_CULL_PAD_PX,
  ARROW_CULL_PAD_PX,
  LINK_CULL_PAD_PX,
);

/**
 * Every layer that is a function of scale, in paint order, onto whichever
 * surface is passed.
 *
 * The background fill and the grid are deliberately NOT here. Both are drawn
 * live on the visible canvas: the grid must fill the viewport at any pan
 * offset, which a tile is not guaranteed to reach, and keeping it live leaves
 * it crisp while the tile is blitted scaled (#152).
 */
export function drawMapLayers(
  ctx: CanvasRenderingContext2D,
  map: Map2d,
  t: Transform,
  width: number,
  height: number,
  colors: Palette,
  game: string | null,
): void {
  drawLines(ctx, map, t, width, height, colors);
  if (mapPrefs.showSecretSectors)
    drawLineOverlay(ctx, map, t, width, height, {
      color: colors.lineSectorSecret,
      dash: SECTOR_DASH,
      marked: (l) => l.secret_sector === true,
    });
  if (mapPrefs.showDamagingSectors)
    drawLineOverlay(ctx, map, t, width, height, {
      color: colors.lineSectorDamage,
      dash: SECTOR_DASH,
      dashOffset: DAMAGE_DASH_OFFSET,
      marked: (l) => l.damaging_sector === true,
    });
  if (mapPrefs.showTeleportLines) {
    drawLineOverlay(ctx, map, t, width, height, {
      color: colors.lineTeleport,
      dash: TELEPORT_DASH,
      marked: (l) => l.teleport === true,
    });
    drawTeleportLinks(ctx, map, t, width, height, colors.lineTeleport);
  }
  if (mapPrefs.showThings) {
    drawThings(ctx, map, t, width, height, colors, game);
    drawMultiplayerStarts(ctx, map, t, width, height, colors, game);
  }
  if (mapPrefs.showPlayerStart) drawPlayerStart(ctx, map, t, colors.player);
}
