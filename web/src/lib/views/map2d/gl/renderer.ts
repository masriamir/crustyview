/**
 * The WebGL2 2D map renderer (#177), productionized from the #157 spike
 * (`bench/gl/renderer.ts`, proven at 60 Hz on a 64k-line map).
 *
 * Reused verbatim from the spike: the line vertex/fragment shaders, the
 * VAO-per-pass structure, the two-pass count-then-fill packing loop, and the
 * `#rrggbb` hex parser. What changed for production:
 *
 * - Colors are never baked into a pass. The spike hardcoded the classic
 *   palette at `loadMap` time; here every pass looks its color up from
 *   `GlFrame.palette` on every `draw()`, because the themed palette (or the
 *   classic/dark/light choice) can change without a new map load.
 * - `feather` is a live uniform, not a shader constant — see the fragment
 *   shader doc for what "live" changes about the AA apron.
 * - A grid pass, absent from the spike (the bench never drew one).
 * - Context-loss recovery: `webglcontextlost`/`webglcontextrestored` handling
 *   and a fallback callback when a restore does not arrive in time.
 * - Things, start darts, and teleport links (#177 Task 3), which need a
 *   second program (`glyphProgram`, below) — the line program's quad-per-
 *   segment shader has no way to draw a filled square or rotated dart, only
 *   a stroked rectangle. Every pass in this file used to share the one line
 *   program; the doc on `link()` below is stale on that point now that a
 *   second program exists, and is corrected there rather than here.
 */
import type { Map2d } from '../../../format';
import { viewportRect } from '../cull';
import {
  LINK_ALPHA,
  LINK_DASH,
  LINK_MARK_ALPHA,
  LINK_RING_RADIUS,
  LINK_WIDTH,
  arrowHeadPoints,
  linkControlPoint,
} from '../linkGeometry';
import {
  ARROW_SIZES,
  DAMAGE_DASH_OFFSET,
  KIND_ORDER,
  KIND_WIDTH,
  OVERLAY_WIDTH,
  PLAYER_ARROW_PX,
  PLAYER_THING_TYPE,
  SECTOR_DASH,
  TELEPORT_DASH,
  THING_PX,
  type Palette,
} from '../render';
import type { TeleportLink } from '../teleportArcs';
import { ARROW_CATEGORIES, ARROW_CATEGORY_ORDER, CATEGORIES, categoryOf, type ThingCategory } from '../things';
import { mapToScreen, type Transform } from '../transform';

type LineKind = Map2d['lines'][number]['kind'];

const VERT = `#version 300 es
// aCorner.x: which endpoint (0|1) along the segment. aCorner.y: which side
// (-1|+1) of the centerline. Locations are explicit — the corner buffer
// (location 0) and the per-instance segment buffer (location 1) are shared
// by every pass this renderer draws (base kinds, dashed overlays, grid), so a
// linker-chosen reordering would silently corrupt all of them at once rather
// than failing to compile.
layout(location = 0) in vec2 aCorner;
// Segment endpoints: (x1, y1, x2, y2), one instance per line — map units
// unless uScreenSpace, in which case they are already CSS-px screen
// coordinates (the teleport link arc/ring passes, whose geometry is
// tessellated per frame from the live transform already — see
// drawLinksPass, which is the only caller that ever sets uScreenSpace).
layout(location = 1) in vec4 aSeg;
// CSS px already traveled along the dashed subpath before this instance's
// own segment — 0 for every pass except teleport link arcs. Every other
// pass's VAO never binds this location, so it reads the WebGL default
// generic-attribute value (0) with no per-pass code needed to keep it that
// way; see drawLinksPass for why a tessellated arc needs it to be anything
// else (the dash phase must flow across all 24 of one arc's segments, not
// restart at each one).
layout(location = 2) in float aAlongOffset;
uniform vec2 uViewport;   // device px
uniform float uScale;     // CSS px per map unit
uniform vec2 uOffset;     // tx, ty in CSS px
uniform float uDpr;
uniform float uWidth;     // stroke width in CSS px
// AA apron half-width, in device px: 1.0 normally, 0.0 when the caller turns
// feather off. Dropping it removes only the fade margin — half_w below is
// untouched, so the quad still covers the full stroke width; it just has no
// extra geometry for the fragment shader's edge smoothstep to fade across.
uniform float uFeather;
// 0: aSeg is map units, transformed the usual way. 1: aSeg is already CSS-px
// screen coordinates — skip uOffset/uScale, apply only uDpr.
uniform float uScreenSpace;
out float vAlong;         // device px along THIS segment, 0 at its start — butt-cap AA only
out float vAcross;        // device px from the centerline
out float vLen;           // segment length in device px
// CSS px along the WHOLE dashed subpath (this segment's local position plus
// aAlongOffset) — dash phase only. Kept separate from vAlong so a segment
// deep into a tessellated arc still gets a correctly-positioned butt-cap
// fade at its own two ends, rather than comparing a large offset position
// against this segment's own (small) length.
out float vDashAlong;
void main() {
  // mapToScreen (transform.ts): sx = tx + x*scale, sy = ty - y*scale.
  vec2 p0 = uScreenSpace > 0.5
    ? aSeg.xy * uDpr
    : (uOffset + vec2(aSeg.x, -aSeg.y) * uScale) * uDpr;
  vec2 p1 = uScreenSpace > 0.5
    ? aSeg.zw * uDpr
    : (uOffset + vec2(aSeg.z, -aSeg.w) * uScale) * uDpr;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  float half_w = uWidth * uDpr * 0.5;
  float along = mix(-uFeather, len + uFeather, aCorner.x);
  vec2 pos = p0 + dir * along + normal * aCorner.y * (half_w + uFeather);
  vAlong = along;
  vAcross = aCorner.y * (half_w + uFeather);
  vLen = len;
  vDashAlong = along / uDpr + aAlongOffset;
  // Screen y grows downward; clip y grows upward.
  gl_Position = vec4(pos / uViewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vAlong;
in float vAcross;
in float vLen;
in float vDashAlong;
uniform float uWidth;   // CSS px
uniform float uDpr;
uniform vec4 uColor;
uniform vec3 uDash;     // on, off, phase in CSS px; on == 0 means solid
out vec4 outColor;
void main() {
  float half_w = uWidth * uDpr * 0.5;
  // Butt caps: fade over one device px at both the sides and the ends. This
  // 0.5 px softening is independent of the vertex shader's uFeather apron —
  // it only needs SOME fragment inside that band to shade, which the exact
  // quad edge (uFeather == 0) still provides; it is simply a harder cutoff
  // with no apron to fade into.
  float aa = (1.0 - smoothstep(half_w - 0.5, half_w + 0.5, abs(vAcross)))
           * smoothstep(-0.5, 0.5, vAlong)
           * (1.0 - smoothstep(vLen - 0.5, vLen + 0.5, vAlong));
  if (uDash.x > 0.0) {
    // Canvas lineDashOffset shifts the pattern start; work in CSS px so the
    // rhythm is DPR-independent, like setLineDash on a dpr-scaled context.
    float period = uDash.x + uDash.y;
    float pos = mod(vDashAlong + uDash.z, period);
    float e = 0.25; // CSS px of AA at dash edges
    aa *= smoothstep(-e, e, pos) * (1.0 - smoothstep(uDash.x - e, uDash.x + e, pos));
  }
  outColor = vec4(uColor.rgb, uColor.a * aa);
}`;

const GLYPH_VERT = `#version 300 es
// A fixed local shape (SQUARE_CORNERS or DART_CORNERS, below) for the
// instanced thing/dart/player passes, rotated and scaled in-shader per
// instance. The teleport arrowhead pass instead feeds this an absolute
// per-vertex offset from that triangle's own tip (uSize 1, aInst.z 0, so
// rotated below reduces to aLocal itself) — see drawLinksPass, which is the
// only caller that draws a shape too irregular to share across instances.
layout(location = 0) in vec2 aLocal;
// Per vertex/instance: x, y, angle (degrees). x/y are map units unless
// uScreenSpace (the arrowhead pass, whose tip is already resolved through
// the live transform by drawLinksPass); angle is always 0 except for start
// darts, which rotate to the thing's facing.
layout(location = 1) in vec3 aInst;
uniform vec2 uViewport;
uniform float uScale;
uniform vec2 uOffset;
uniform float uDpr;
uniform float uSize;        // CSS px
uniform float uScreenSpace; // 0: aInst.xy is map units; 1: already CSS px
void main() {
  vec2 center = uScreenSpace > 0.5
    ? aInst.xy * uDpr
    : (uOffset + vec2(aInst.x, -aInst.y) * uScale) * uDpr;
  // Matches drawStartArrow's ctx.rotate(-angle): screen Y is flipped
  // relative to the map's angle convention, so the same doomednum angle
  // must turn the same way on both renderers.
  float rad = radians(-aInst.z);
  float c = cos(rad);
  float s = sin(rad);
  vec2 rotated = vec2(aLocal.x * c - aLocal.y * s, aLocal.x * s + aLocal.y * c);
  vec2 pos = center + rotated * uSize * uDpr;
  gl_Position = vec4(pos / uViewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const GLYPH_FRAG = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

/** on/off/phase, all in CSS px; `on == 0` means the fragment shader treats
 *  the pass as solid (see `uDash` in `FRAG`). */
const SOLID_DASH: readonly [number, number, number] = [0, 0, 0];
const GRID_WIDTH = 1;

/** Unit square corners (centered at origin, half-extent 0.5), for the
 *  per-category thing-rect glyph pass — a TRIANGLE_STRIP. Scaled by `uSize`
 *  (`THING_PX` CSS px) and never rotated: things always feed `aInst.z = 0`. */
const SQUARE_CORNERS = new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5]);

/**
 * Unit dart/kite corners for the start-marker glyph pass — a TRIANGLE_FAN
 * from vertex 0 (the tip), matching `drawStartArrow`'s own vertex order
 * (render.ts) and its `closePath` back to that tip: `(half, 0), (-half,
 * -half*0.8), (-half*0.4, 0), (-half, half*0.8)` with `half` folded into
 * `uSize` here (unit half = 0.5, scaled by `uSize` — `ARROW_SIZES[category]`
 * or `PLAYER_ARROW_PX` — in-shader).
 */
const DART_CORNERS = new Float32Array([0.5, 0, -0.5, -0.4, -0.2, 0, -0.5, 0.4]);

/** Quadratic-bezier segments per teleport link arc. Canvas draws a true
 *  curve (`quadraticCurveTo`); this is the CPU tessellation drawLinksPass
 *  approximates it with, high enough that the facets are not visible at any
 *  zoom a teleport arc is legible at. */
const LINK_ARC_SEGMENTS = 24;
/** Segments per source-ring circle, same rationale as LINK_ARC_SEGMENTS. */
const LINK_RING_SEGMENTS = 16;

/**
 * Grace period between `webglcontextlost` and giving up on a restore, in ms.
 * `webglcontextrestored` normally arrives within a frame or two of a loss
 * when it is going to arrive at all (a GPU driver reset, a backgrounded
 * tab); 3000 ms comfortably covers that while still failing over to the
 * canvas renderer well inside a user's patience for a stalled map.
 */
const CONTEXT_LOST_GRACE_MS = 3000;

export type Rgb = readonly [number, number, number];

export interface GlRendererOptions {
  /** Context `antialias` attribute (MSAA). A context-creation choice, not a
   *  live setting — changing it means a new canvas/renderer, not a redraw. */
  msaa: boolean;
  /** Required for `readPixels` to see a composited frame after the browser's
   *  own compositing step; tests only. Defaults to `false` in production,
   *  where nothing ever reads the drawing buffer back. */
  preserveDrawingBuffer?: boolean;
}

/** `Palette`'s hex strings, resolved once per draw into GL-ready floats. */
export interface GlPalette {
  bg: Rgb;
  grid: Rgb;
  wall: Rgb;
  twoSided: Rgb;
  secret: Rgb;
  lineTeleport: Rgb;
  lineSectorSecret: Rgb;
  lineSectorDamage: Rgb;
  things: Record<ThingCategory, Rgb>;
  player: Rgb;
}

/** `#rrggbb` → `[r, g, b]` floats in `[0, 1]`. Assumes a 6-digit hex string
 *  with a leading `#` — the only shape `resolvePalette` ever produces. */
function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/**
 * Parses every field of a canvas `Palette` into `GlPalette` floats.
 *
 * Pure and GL-independent, so it is unit-testable without a canvas
 * (`gl/parsePalette.test.ts`). Not memoized here — the caller knows when the
 * underlying theme/style actually changed and can cache accordingly; this
 * function re-parses on every call, deliberately, to stay a plain function of
 * its input.
 */
export function parsePalette(palette: Palette): GlPalette {
  return {
    bg: hexToRgb(palette.bg),
    grid: hexToRgb(palette.grid),
    wall: hexToRgb(palette.wall),
    twoSided: hexToRgb(palette.twoSided),
    secret: hexToRgb(palette.secret),
    lineTeleport: hexToRgb(palette.lineTeleport),
    lineSectorSecret: hexToRgb(palette.lineSectorSecret),
    lineSectorDamage: hexToRgb(palette.lineSectorDamage),
    things: Object.fromEntries(
      (Object.entries(palette.things) as [ThingCategory, string][]).map(([category, hex]) => [
        category,
        hexToRgb(hex),
      ]),
    ) as Record<ThingCategory, Rgb>,
    player: hexToRgb(palette.player),
  };
}

/** Everything one `draw()` needs, resolved by the caller once per frame. */
export interface GlFrame {
  transform: Transform;
  widthCss: number;
  heightCss: number;
  dpr: number;
  palette: GlPalette;
  feather: boolean;
  /** `effectiveGridSize` result in map units; `null` hides the grid pass. */
  grid: number | null;
  show: {
    teleportLines: boolean;
    secretSectors: boolean;
    damagingSectors: boolean;
    things: boolean;
    playerStart: boolean;
    categories: Record<ThingCategory, boolean>;
  };
  /** Pre-culled, pre-capped teleport link arcs — gating is entirely the
   *  caller's: an empty array draws nothing (drawLinksPass), so a hidden
   *  "show teleport arcs" preference is expressed by passing `[]`, not by a
   *  `show` flag here. */
  arcs: readonly TeleportLink[];
}

/** One instanced-quad draw call's worth of GPU state. Colors are
 *  deliberately absent: every pass is colored from `GlFrame.palette` at
 *  draw time, never baked in at load time (see the module doc). The
 *  instance buffer itself is not kept here — cleanup goes through the
 *  renderer's `mapBuffers`/`mapVaos` arrays instead, so keeping a second
 *  reference on the pass would just be a handle nothing ever reads. */
interface Pass {
  vao: WebGLVertexArrayObject;
  count: number;
  width: number;
  dash: readonly [number, number, number];
}

/** A `thingPasses`/`dartPasses`/`playerPass` draw call's worth of GPU state
 *  for the glyph program — `mode`/`vertsPerInstance` vary per shape
 *  (SQUARE_CORNERS is a 4-vertex TRIANGLE_STRIP, DART_CORNERS a 4-vertex
 *  TRIANGLE_FAN), so each pass carries the draw call it needs rather than
 *  the caller guessing. Colors are resolved from `GlFrame.palette` at draw
 *  time, same rationale as `Pass`. */
interface GlyphPass {
  vao: WebGLVertexArrayObject;
  count: number;
  mode: GLenum;
  vertsPerInstance: number;
}

/** `CATEGORIES` minus the two that skip the rect batch for their own
 *  rotated-dart pass (things.ts's `ARROW_CATEGORIES`) — derived from
 *  `ARROW_CATEGORY_ORDER` rather than hand-listed, so a category added to
 *  either array cannot silently fall out of sync with this type. */
type RectThingCategory = Exclude<ThingCategory, (typeof ARROW_CATEGORY_ORDER)[number]>;

/**
 * Thrown by shader compilation or program linking, as opposed to no WebGL2
 * context being available at all. `createGlRenderer` treats the two
 * differently: no context is an expected, silent fallback (the product
 * works everywhere); a shader that fails to compile or link is a real bug in
 * this file's GLSL and must never look identical to an old browser, so it is
 * surfaced via console.error. The message always carries the driver's own
 * info-log text, which is what makes it worth reporting.
 */
class ShaderError extends Error {}

function createBuffer(gl: WebGL2RenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('createBuffer failed');
  return buffer;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'shader compile failed';
    gl.deleteShader(shader);
    throw new ShaderError(log);
  }
  return shader;
}

/**
 * Compiles and links one program. Two are built from this: `program` (the
 * line/quad shader — base kinds, dashed overlays, the grid, and the teleport
 * arc/ring passes all share it) and `glyphProgram` (things, start darts, and
 * teleport arrowheads — filled shapes the line shader has no way to draw;
 * see the module doc). Only the buffer, uniforms, and draw call vary within
 * each program's own set of passes.
 */
function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  const vertShader = compileShader(gl, gl.VERTEX_SHADER, vert);
  let fragShader: WebGLShader;
  try {
    fragShader = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  } catch (error) {
    gl.deleteShader(vertShader);
    throw error;
  }
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  // Standard cleanup: once a program is linked (or has failed to link), the
  // compiled shader objects behind it are never needed again — the program
  // itself is what draw calls use. Skipping this leaks a shader pair per
  // construction and per context restore.
  gl.deleteShader(vertShader);
  gl.deleteShader(fragShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new ShaderError(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  return program;
}

/** Which `GlPalette` field colors each base line kind — mirrors render.ts's
 *  private `kindColor` record (`drawLines`). */
const KIND_PALETTE_KEY: Record<LineKind, 'wall' | 'twoSided' | 'secret'> = {
  two_sided: 'twoSided',
  one_sided: 'wall',
  secret: 'secret',
};

type PackKey = LineKind | 'teleport' | 'secretSector' | 'damageSector';

export class GlMapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly opts: GlRendererOptions;
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private cornerBuffer!: WebGLBuffer;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  /** The glyph program (things, start darts, teleport arrowheads) and its
   *  own uniform set — a separate program from `program`/`uniforms` (see
   *  `link`'s doc), so its locations live in their own record rather than
   *  sharing (and colliding with) the line program's. */
  private glyphProgram!: WebGLProgram;
  private glyphUniforms: Record<string, WebGLUniformLocation | null> = {};
  /** Static local shapes for the glyph program's instanced passes — see
   *  SQUARE_CORNERS/DART_CORNERS. Permanent, like `cornerBuffer`. */
  private squareCornerBuffer!: WebGLBuffer;
  private dartCornerBuffer!: WebGLBuffer;

  /** One pass per base line kind, plus the three dashed overlays. All four
   *  are (re)built together by `uploadMap`, so a single null check on
   *  `linePasses` is enough to know whether a map has been loaded yet. */
  private linePasses: Record<LineKind, Pass> | null = null;
  private secretSectorPass: Pass | null = null;
  private damageSectorPass: Pass | null = null;
  private teleportPass: Pass | null = null;
  /** One rect-glyph pass per non-arrow category, one dart-glyph pass per
   *  `ARROW_CATEGORY_ORDER` member, and the player-1 dart (0 or 1 instance,
   *  found once at load time — mirrors `drawPlayerStart`'s `.find`). All
   *  three are (re)built together by `uploadMap`, alongside `linePasses`. */
  private thingPasses: Record<RectThingCategory, GlyphPass> | null = null;
  private dartPasses: Record<(typeof ARROW_CATEGORY_ORDER)[number], GlyphPass> | null = null;
  private playerPass: GlyphPass | null = null;
  /** Buffers/VAOs owned by the current map upload, tracked separately from
   *  the fixed per-renderer resources (program, corner buffer, grid VAO) so
   *  `uploadMap` can free exactly last map's objects and nothing else. */
  private mapBuffers: WebGLBuffer[] = [];
  private mapVaos: WebGLVertexArrayObject[] = [];

  /** The grid pass's instance buffer is rebuilt from scratch on every
   *  `draw()` (see `drawGridPass`) — a few hundred instances at most, so
   *  there is nothing worth caching. Only the VAO/buffer handles are
   *  permanent. */
  private gridVao!: WebGLVertexArrayObject;
  private gridBuffer!: WebGLBuffer;

  /** Teleport link geometry (drawLinksPass) is tessellated fresh every
   *  frame, same rationale as the grid: at most ~100 arcs (the caller's
   *  cap), so rebuilding costs nothing and caching would only add an
   *  invalidation problem. Only the VAO/buffer handles are permanent. Arcs
   *  (dashed, line program) and rings (solid, line program) are separate
   *  passes because a draw call has one uDash value; arrowheads (filled,
   *  glyph program, non-instanced — see linkArrowVao) are a third. */
  private linkArcVao!: WebGLVertexArrayObject;
  private linkArcBuffer!: WebGLBuffer;
  private linkArcAlongBuffer!: WebGLBuffer;
  private linkRingVao!: WebGLVertexArrayObject;
  private linkRingBuffer!: WebGLBuffer;
  private linkArrowVao!: WebGLVertexArrayObject;
  private linkArrowLocalBuffer!: WebGLBuffer;
  private linkArrowCenterBuffer!: WebGLBuffer;

  private currentMap: Map2d | null = null;
  private currentGame: string | null = null;

  private lostCallback: (() => void) | null = null;
  private lostTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /** @throws if no WebGL2 context, or shader compile/link, fails. Use
   *  {@link createGlRenderer} for a non-throwing factory. */
  constructor(canvas: HTMLCanvasElement, opts: GlRendererOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.initContext();
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  /**
   * (Re)creates the GL context and every resource that depends on it.
   * Called from the constructor, and again from the `webglcontextrestored`
   * handler — a lost context invalidates every GL object the old one owned,
   * not just the ones tied to the current map, so a restore rebuilds
   * everything this method builds, in the same order.
   */
  private initContext(): void {
    const gl = this.canvas.getContext('webgl2', {
      antialias: this.opts.msaa,
      alpha: false,
      preserveDrawingBuffer: this.opts.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.program = link(gl, VERT, FRAG);
    gl.useProgram(this.program);
    for (const name of [
      'uViewport',
      'uScale',
      'uOffset',
      'uDpr',
      'uWidth',
      'uColor',
      'uDash',
      'uFeather',
      'uScreenSpace',
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.glyphProgram = link(gl, GLYPH_VERT, GLYPH_FRAG);
    gl.useProgram(this.glyphProgram);
    for (const name of ['uViewport', 'uScale', 'uOffset', 'uDpr', 'uSize', 'uColor', 'uScreenSpace']) {
      this.glyphUniforms[name] = gl.getUniformLocation(this.glyphProgram, name);
    }
    // Unit quad as a 4-vertex triangle strip: (0,-1) (0,1) (1,-1) (1,1).
    this.cornerBuffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    this.gridBuffer = createBuffer(gl);
    this.gridVao = this.createLineVao(this.gridBuffer);

    this.squareCornerBuffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.squareCornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, SQUARE_CORNERS, gl.STATIC_DRAW);
    this.dartCornerBuffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dartCornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, DART_CORNERS, gl.STATIC_DRAW);

    // Teleport link geometry: rebuilt every draw() (drawLinksPass), so only
    // the buffer/VAO handles need to survive a context restore — their data
    // is uploaded fresh on the next frame regardless.
    this.linkArcBuffer = createBuffer(gl);
    this.linkArcAlongBuffer = createBuffer(gl);
    this.linkArcVao = this.createLinkArcVao(this.linkArcBuffer, this.linkArcAlongBuffer);
    this.linkRingBuffer = createBuffer(gl);
    this.linkRingVao = this.createLineVao(this.linkRingBuffer);
    this.linkArrowLocalBuffer = createBuffer(gl);
    this.linkArrowCenterBuffer = createBuffer(gl);
    this.linkArrowVao = this.createGlyphVao(this.linkArrowLocalBuffer, this.linkArrowCenterBuffer, 0);
  }

  /** One VAO wired to the shared corner buffer (location 0, the quad shape)
   *  and a caller-owned instance buffer of `vec4` segments (location 1, one
   *  instance per line). Every line-program pass — base kinds, overlays,
   *  grid, teleport rings — is this same wiring over a different buffer.
   *  Teleport arcs are the one exception (`createLinkArcVao`): they also
   *  need the per-instance dash-offset attribute this VAO leaves disabled
   *  (and so, for every pass built from this method, at its WebGL default of
   *  0 — see `aAlongOffset` in `VERT`). */
  private createLineVao(instanceBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  /** `createLineVao` plus the per-instance `aAlongOffset` float (location 2,
   *  divisor 1) that lets a tessellated arc's dash phase flow across its 24
   *  segments instead of restarting at each one (drawLinksPass). The only
   *  caller of this method is the teleport arc pass. */
  private createLinkArcVao(segBuffer: WebGLBuffer, alongBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, alongBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * One VAO wired to a local-shape buffer (location 0: `aLocal`) and an
   * instance buffer of `vec3` (x, y, angle) (location 1: `aInst`), for the
   * glyph program. `divisor` is 1 for the instanced passes (things, darts,
   * the player start — one shared local shape, many instances) and 0 for
   * the teleport arrowhead pass, whose "local shape" is a different
   * triangle per arc: with both attributes at divisor 0, a plain
   * (non-instanced) `drawArrays` reads matching `aLocal`/`aInst` entries per
   * vertex instead of per instance — see `drawLinkArrowheads`.
   */
  private createGlyphVao(
    localBuffer: WebGLBuffer,
    instanceBuffer: WebGLBuffer,
    divisor: 0 | 1,
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, localBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, divisor);
    gl.bindVertexArray(null);
    return vao;
  }

  /**
   * Packs the map's lines into per-pass instance buffers and uploads them,
   * plus the thing/dart/player glyph passes (categorized via `game`, stored
   * from `loadMap`).
   */
  loadMap(map: Map2d, game: string | null): void {
    this.currentMap = map;
    this.currentGame = game;
    this.uploadMap(map);
  }

  private uploadMap(map: Map2d): void {
    const gl = this.gl;
    for (const buffer of this.mapBuffers) gl.deleteBuffer(buffer);
    for (const vao of this.mapVaos) gl.deleteVertexArray(vao);
    this.mapBuffers = [];
    this.mapVaos = [];

    // Two-pass pack: count every kind/flag first so each Float32Array is
    // allocated exactly once at its final size, then fill. A naive
    // push-as-you-go loop would instead grow and copy per line, which is the
    // difference between this holding 60 Hz on a 64k-line map and not (#157).
    const kinds: Record<LineKind, number> = { two_sided: 0, one_sided: 0, secret: 0 };
    let teleport = 0;
    let secretSector = 0;
    let damageSector = 0;
    for (const line of map.lines) {
      kinds[line.kind] += 1;
      if (line.teleport === true) teleport += 1;
      if (line.secret_sector === true) secretSector += 1;
      if (line.damaging_sector === true) damageSector += 1;
    }
    const arrays: Record<PackKey, Float32Array> = {
      two_sided: new Float32Array(kinds.two_sided * 4),
      one_sided: new Float32Array(kinds.one_sided * 4),
      secret: new Float32Array(kinds.secret * 4),
      teleport: new Float32Array(teleport * 4),
      secretSector: new Float32Array(secretSector * 4),
      damageSector: new Float32Array(damageSector * 4),
    };
    const cursor: Record<PackKey, number> = {
      two_sided: 0,
      one_sided: 0,
      secret: 0,
      teleport: 0,
      secretSector: 0,
      damageSector: 0,
    };
    const put = (key: PackKey, line: Map2d['lines'][number]) => {
      const at = cursor[key];
      const a = arrays[key];
      a[at] = line.x1;
      a[at + 1] = line.y1;
      a[at + 2] = line.x2;
      a[at + 3] = line.y2;
      cursor[key] = at + 4;
    };
    for (const line of map.lines) {
      put(line.kind, line);
      if (line.teleport === true) put('teleport', line);
      if (line.secret_sector === true) put('secretSector', line);
      if (line.damaging_sector === true) put('damageSector', line);
    }

    // Paint order matches drawMapLayers: base kinds back-to-front
    // (KIND_ORDER), then the dashed overlays — secret sector, damaging
    // sector (phase-shifted by DAMAGE_DASH_OFFSET so a line bordering both
    // interleaves the two colors instead of one hiding the other), teleport.
    this.linePasses = {
      two_sided: this.makePass(arrays.two_sided, kinds.two_sided, KIND_WIDTH.two_sided, SOLID_DASH),
      one_sided: this.makePass(arrays.one_sided, kinds.one_sided, KIND_WIDTH.one_sided, SOLID_DASH),
      secret: this.makePass(arrays.secret, kinds.secret, KIND_WIDTH.secret, SOLID_DASH),
    };
    this.secretSectorPass = this.makePass(arrays.secretSector, secretSector, OVERLAY_WIDTH, [
      SECTOR_DASH[0],
      SECTOR_DASH[1],
      0,
    ]);
    this.damageSectorPass = this.makePass(arrays.damageSector, damageSector, OVERLAY_WIDTH, [
      SECTOR_DASH[0],
      SECTOR_DASH[1],
      DAMAGE_DASH_OFFSET,
    ]);
    this.teleportPass = this.makePass(arrays.teleport, teleport, OVERLAY_WIDTH, [
      TELEPORT_DASH[0],
      TELEPORT_DASH[1],
      0,
    ]);

    // One categorization pass over map.things, reused for both the
    // thing-rect buffers and the start-dart buffers: categoryOf's result
    // decides which of the two a given thing feeds (things.ts's
    // ARROW_CATEGORIES), so counting/packing them together, then splitting
    // the finished per-category arrays by that same membership check, avoids
    // categorizing each thing twice.
    const game = this.currentGame;
    const categoryCounts: Record<ThingCategory, number> = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, 0]),
    ) as Record<ThingCategory, number>;
    for (const thing of map.things) categoryCounts[categoryOf(thing.type_id, game)] += 1;
    const categoryArrays: Record<ThingCategory, Float32Array> = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, new Float32Array(categoryCounts[c.id] * 3)]),
    ) as Record<ThingCategory, Float32Array>;
    const categoryCursor: Record<ThingCategory, number> = Object.fromEntries(
      CATEGORIES.map((c) => [c.id, 0]),
    ) as Record<ThingCategory, number>;
    for (const thing of map.things) {
      const category = categoryOf(thing.type_id, game);
      const at = categoryCursor[category];
      const a = categoryArrays[category];
      a[at] = thing.x;
      a[at + 1] = thing.y;
      // Only start darts rotate (GLYPH_VERT); the rect-batch categories
      // always feed angle 0.
      a[at + 2] = ARROW_CATEGORIES.has(category) ? thing.angle : 0;
      categoryCursor[category] = at + 3;
    }

    this.thingPasses = Object.fromEntries(
      CATEGORIES.filter((c) => !ARROW_CATEGORIES.has(c.id)).map((c) => [
        c.id,
        this.makeGlyphPass(categoryArrays[c.id], categoryCounts[c.id], this.squareCornerBuffer, {
          mode: gl.TRIANGLE_STRIP,
          vertsPerInstance: 4,
        }),
      ]),
    ) as Record<RectThingCategory, GlyphPass>;
    this.dartPasses = Object.fromEntries(
      ARROW_CATEGORY_ORDER.map((category) => [
        category,
        this.makeGlyphPass(categoryArrays[category], categoryCounts[category], this.dartCornerBuffer, {
          mode: gl.TRIANGLE_FAN,
          vertsPerInstance: 4,
        }),
      ]),
    ) as Record<(typeof ARROW_CATEGORY_ORDER)[number], GlyphPass>;

    // Mirrors drawPlayerStart's `.find` — the first player-1 thing, if any.
    const player = map.things.find((thing) => thing.type_id === PLAYER_THING_TYPE);
    const playerArray = player ? new Float32Array([player.x, player.y, player.angle]) : new Float32Array(0);
    this.playerPass = this.makeGlyphPass(playerArray, player ? 1 : 0, this.dartCornerBuffer, {
      mode: gl.TRIANGLE_FAN,
      vertsPerInstance: 4,
    });
  }

  private makePass(
    segments: Float32Array,
    count: number,
    width: number,
    dash: readonly [number, number, number],
  ): Pass {
    const gl = this.gl;
    const buffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, segments, gl.STATIC_DRAW);
    const vao = this.createLineVao(buffer);
    this.mapBuffers.push(buffer);
    this.mapVaos.push(vao);
    return { vao, count, width, dash };
  }

  private makeGlyphPass(
    instances: Float32Array,
    count: number,
    localBuffer: WebGLBuffer,
    shape: { mode: GLenum; vertsPerInstance: number },
  ): GlyphPass {
    const gl = this.gl;
    const buffer = createBuffer(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.STATIC_DRAW);
    const vao = this.createGlyphVao(localBuffer, buffer, 1);
    this.mapBuffers.push(buffer);
    this.mapVaos.push(vao);
    return { vao, count, mode: shape.mode, vertsPerInstance: shape.vertsPerInstance };
  }

  /** Full-frame redraw: clear, grid, base kinds, dashed overlays — in
   *  render.ts's `drawMapLayers` paint order (grid drawn live underneath,
   *  same as the canvas path draws it before the tile/direct layers). */
  draw(frame: GlFrame): void {
    if (this.disposed || !this.linePasses) return;
    const gl = this.gl;
    const deviceW = Math.max(1, Math.round(frame.widthCss * frame.dpr));
    const deviceH = Math.max(1, Math.round(frame.heightCss * frame.dpr));
    gl.viewport(0, 0, deviceW, deviceH);
    gl.clearColor(frame.palette.bg[0], frame.palette.bg[1], frame.palette.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniform2f(this.uniforms.uViewport, deviceW, deviceH);
    gl.uniform1f(this.uniforms.uScale, frame.transform.scale);
    gl.uniform2f(this.uniforms.uOffset, frame.transform.tx, frame.transform.ty);
    gl.uniform1f(this.uniforms.uDpr, frame.dpr);
    gl.uniform1f(this.uniforms.uFeather, frame.feather ? 1 : 0);

    gl.useProgram(this.glyphProgram);
    gl.uniform2f(this.glyphUniforms.uViewport, deviceW, deviceH);
    gl.uniform1f(this.glyphUniforms.uScale, frame.transform.scale);
    gl.uniform2f(this.glyphUniforms.uOffset, frame.transform.tx, frame.transform.ty);
    gl.uniform1f(this.glyphUniforms.uDpr, frame.dpr);

    this.drawGridPass(frame);

    for (const kind of KIND_ORDER) {
      const pass = this.linePasses[kind];
      this.drawLineInstances(pass.vao, pass.count, pass.width, pass.dash, frame.palette[KIND_PALETTE_KEY[kind]]);
    }
    if (frame.show.secretSectors && this.secretSectorPass) {
      const p = this.secretSectorPass;
      this.drawLineInstances(p.vao, p.count, p.width, p.dash, frame.palette.lineSectorSecret);
    }
    if (frame.show.damagingSectors && this.damageSectorPass) {
      const p = this.damageSectorPass;
      this.drawLineInstances(p.vao, p.count, p.width, p.dash, frame.palette.lineSectorDamage);
    }
    if (frame.show.teleportLines && this.teleportPass) {
      const p = this.teleportPass;
      this.drawLineInstances(p.vao, p.count, p.width, p.dash, frame.palette.lineTeleport);
    }

    // drawMapLayers order (render.ts): the arcs pass sits here, before
    // things/darts and after every line-based pass above.
    this.drawLinksPass(frame);

    if (frame.show.things && this.thingPasses) {
      // Reverse CATEGORIES order, mirroring drawThings: the chip list's top
      // categories paint last, on top. Arrow categories never got a
      // thingPasses entry (uploadMap filters them out), so this loop only
      // ever touches RectThingCategory keys.
      for (let i = CATEGORIES.length - 1; i >= 0; i--) {
        const category = CATEGORIES[i].id;
        if (ARROW_CATEGORIES.has(category) || !frame.show.categories[category]) continue;
        const pass = this.thingPasses[category as RectThingCategory];
        this.drawGlyphInstances(pass, THING_PX, frame.palette.things[category]);
      }
    }
    if (frame.show.things && this.dartPasses) {
      // ARROW_CATEGORY_ORDER's own order: deathmatch first so co-op paints
      // above it, mirroring drawMultiplayerStarts.
      for (const category of ARROW_CATEGORY_ORDER) {
        if (!frame.show.categories[category]) continue;
        this.drawGlyphInstances(this.dartPasses[category], ARROW_SIZES[category], frame.palette.things[category]);
      }
    }
    // Independent of show.things (drawPlayerStart's own top-level gate in
    // drawMapLayers) and drawn last, never culled.
    if (frame.show.playerStart && this.playerPass) {
      this.drawGlyphInstances(this.playerPass, PLAYER_ARROW_PX, frame.palette.player);
    }

    gl.bindVertexArray(null);
  }

  private drawLineInstances(
    vao: WebGLVertexArrayObject,
    count: number,
    width: number,
    dash: readonly [number, number, number],
    color: Rgb,
    options: { alpha?: number; screenSpace?: boolean } = {},
  ): void {
    if (count === 0) return;
    const { alpha = 1, screenSpace = false } = options;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform1f(this.uniforms.uWidth, width);
    gl.uniform4f(this.uniforms.uColor, color[0], color[1], color[2], alpha);
    gl.uniform3f(this.uniforms.uDash, dash[0], dash[1], dash[2]);
    gl.uniform1f(this.uniforms.uScreenSpace, screenSpace ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  private drawGlyphInstances(
    pass: GlyphPass,
    size: number,
    color: Rgb,
    options: { alpha?: number; screenSpace?: boolean } = {},
  ): void {
    if (pass.count === 0) return;
    const { alpha = 1, screenSpace = false } = options;
    const gl = this.gl;
    gl.useProgram(this.glyphProgram);
    gl.uniform1f(this.glyphUniforms.uSize, size);
    gl.uniform4f(this.glyphUniforms.uColor, color[0], color[1], color[2], alpha);
    gl.uniform1f(this.glyphUniforms.uScreenSpace, screenSpace ? 1 : 0);
    gl.bindVertexArray(pass.vao);
    gl.drawArraysInstanced(pass.mode, 0, pass.vertsPerInstance, pass.count);
  }

  /**
   * Teleport links (render.ts's drawTeleportLinks): per frame, tessellate
   * every arc in `frame.arcs` — already pre-culled and pre-capped by the
   * caller, so this is at most a few thousand short segments even at the
   * highest arc cap — into three CPU-built buffers, then draw each as its
   * own pass. All three read `from`/`to`/`control` in screen CSS px (already
   * resolved through the live transform via `mapToScreen`, same as the
   * canvas path computes them), so the line-program passes below draw with
   * `screenSpace: true` and the arrowhead's centers are fed pre-resolved
   * too — none of the three passes touches `uScale`/`uOffset`.
   */
  private drawLinksPass(frame: GlFrame): void {
    const arcs = frame.arcs;
    if (arcs.length === 0) return;
    const gl = this.gl;

    const arcSegments: number[] = [];
    const arcAlong: number[] = [];
    const ringSegments: number[] = [];
    const arrowLocal: number[] = [];
    const arrowCenter: number[] = [];

    for (const link of arcs) {
      const from = mapToScreen(frame.transform, link.from[0], link.from[1]);
      const to = mapToScreen(frame.transform, link.to[0], link.to[1]);
      const control = linkControlPoint(from, to);

      let traveled = 0;
      let prev = from;
      for (let i = 1; i <= LINK_ARC_SEGMENTS; i++) {
        const t = i / LINK_ARC_SEGMENTS;
        const mt = 1 - t;
        const point = {
          x: mt * mt * from.x + 2 * mt * t * control.x + t * t * to.x,
          y: mt * mt * from.y + 2 * mt * t * control.y + t * t * to.y,
        };
        arcSegments.push(prev.x, prev.y, point.x, point.y);
        arcAlong.push(traveled);
        traveled += Math.hypot(point.x - prev.x, point.y - prev.y);
        prev = point;
      }

      for (let i = 0; i < LINK_RING_SEGMENTS; i++) {
        const a0 = (i / LINK_RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((i + 1) / LINK_RING_SEGMENTS) * Math.PI * 2;
        ringSegments.push(
          from.x + Math.cos(a0) * LINK_RING_RADIUS,
          from.y + Math.sin(a0) * LINK_RING_RADIUS,
          from.x + Math.cos(a1) * LINK_RING_RADIUS,
          from.y + Math.sin(a1) * LINK_RING_RADIUS,
        );
      }

      // Aimed along the curve's exit (control -> to), not the chord, or the
      // head sits skewed to the stroke it terminates — matches
      // drawArrowHead's own call (render.ts).
      const [barbA, barbB] = arrowHeadPoints(to, control);
      arrowCenter.push(to.x, to.y, 0, to.x, to.y, 0, to.x, to.y, 0);
      arrowLocal.push(0, 0, barbA.x - to.x, barbA.y - to.y, barbB.x - to.x, barbB.y - to.y);
    }

    const arcCount = arcSegments.length / 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkArcBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arcSegments), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkArcAlongBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arcAlong), gl.DYNAMIC_DRAW);
    this.drawLineInstances(
      this.linkArcVao,
      arcCount,
      LINK_WIDTH,
      [LINK_DASH[0], LINK_DASH[1], 0],
      frame.palette.lineTeleport,
      { alpha: LINK_ALPHA, screenSpace: true },
    );

    const ringCount = ringSegments.length / 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkRingBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ringSegments), gl.DYNAMIC_DRAW);
    this.drawLineInstances(this.linkRingVao, ringCount, LINK_WIDTH, SOLID_DASH, frame.palette.lineTeleport, {
      alpha: LINK_MARK_ALPHA,
      screenSpace: true,
    });

    this.drawLinkArrowheads(arrowLocal, arrowCenter, frame.palette.lineTeleport);
  }

  /** The filled arrowhead triangles (render.ts's `drawArrowHead`), one per
   *  arc: a non-instanced `TRIANGLES` draw over the glyph program, since
   *  each triangle's shape is unique to its own arc (`arrowHeadPoints`
   *  depends on that arc's `to`/`control`) rather than a shared local shape
   *  rotated per instance like the thing/dart passes — see `createGlyphVao`
   *  and `linkArrowVao`'s divisor-0 wiring. */
  private drawLinkArrowheads(local: number[], center: number[], color: Rgb): void {
    const triCount = local.length / 6; // 3 vertices * 2 floats (aLocal) per triangle
    if (triCount === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkArrowLocalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(local), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.linkArrowCenterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(center), gl.DYNAMIC_DRAW);
    gl.useProgram(this.glyphProgram);
    gl.uniform1f(this.glyphUniforms.uSize, 1);
    gl.uniform4f(this.glyphUniforms.uColor, color[0], color[1], color[2], LINK_MARK_ALPHA);
    gl.uniform1f(this.glyphUniforms.uScreenSpace, 1);
    gl.bindVertexArray(this.linkArrowVao);
    gl.drawArrays(gl.TRIANGLES, 0, triCount * 3);
  }

  /**
   * Builds and draws the grid instance buffer fresh every frame — unlike the
   * map passes, `frame.grid`, the transform, and the viewport can all change
   * on every draw, and even a large map's visible grid tops out at a few
   * hundred lines, so rebuilding is cheap and caching would only add a
   * second invalidation problem to solve. Never call `bufferSubData` here:
   * the instance count itself changes every draw.
   *
   * Bounds are exactly `drawGrid`'s (render.ts): the visible map rect from
   * `viewportRect`, and nothing else. Deliberately NOT intersected with the
   * map's own bounds — the canvas path never clips the grid to `map.bounds`
   * either, so a zoomed-out view over a small map gets a grid across the
   * whole visible viewport on both renderers, not just up to the map's
   * edge. (An earlier draft of this pass added a bounds intersection the
   * canvas path does not have; corrected during review — parity with the
   * shipped renderer governs over the written brief where the two
   * disagree.)
   */
  private drawGridPass(frame: GlFrame): void {
    const step = frame.grid;
    if (step === null) return;

    const { minX, maxX, minY, maxY } = viewportRect(
      frame.transform,
      frame.widthCss,
      frame.heightCss,
      0,
    );

    const segments: number[] = [];
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      segments.push(x, minY, x, maxY);
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      segments.push(minX, y, maxX, y);
    }
    const count = segments.length / 4;
    if (count === 0) return;

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(segments), gl.STREAM_DRAW);
    this.drawLineInstances(this.gridVao, count, GRID_WIDTH, SOLID_DASH, frame.palette.grid);
  }

  /**
   * Paint the background and nothing else, for a caller's "nothing to draw
   * yet" frame.
   *
   * The canvas is created with `alpha: false`, and a drawing buffer that has
   * never been cleared composites opaque BLACK — so a GL mount whose first
   * frame lands before the map has a transform would flash black, which
   * against a light theme is a visible white-black-map flicker. The canvas
   * path fills its background before the same bail; this is the GL
   * equivalent, and deliberately the whole of it.
   *
   * Unlike `draw()` this does not require a loaded map: the frames it exists
   * for are precisely the ones before one arrives.
   */
  clear(bg: Rgb): void {
    if (this.disposed) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Frees every GL object this renderer owns and removes the context-loss
   * listeners. Does not touch `WEBGL_lose_context` — that extension
   * simulates a hardware loss for testing; a normal dispose only needs the
   * objects gone, not the context itself invalidated.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    if (this.lostTimer !== null) {
      clearTimeout(this.lostTimer);
      this.lostTimer = null;
    }
    const gl = this.gl;
    for (const buffer of this.mapBuffers) gl.deleteBuffer(buffer);
    for (const vao of this.mapVaos) gl.deleteVertexArray(vao);
    gl.deleteBuffer(this.gridBuffer);
    gl.deleteVertexArray(this.gridVao);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteBuffer(this.squareCornerBuffer);
    gl.deleteBuffer(this.dartCornerBuffer);
    gl.deleteBuffer(this.linkArcBuffer);
    gl.deleteBuffer(this.linkArcAlongBuffer);
    gl.deleteVertexArray(this.linkArcVao);
    gl.deleteBuffer(this.linkRingBuffer);
    gl.deleteVertexArray(this.linkRingVao);
    gl.deleteBuffer(this.linkArrowLocalBuffer);
    gl.deleteBuffer(this.linkArrowCenterBuffer);
    gl.deleteVertexArray(this.linkArrowVao);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.glyphProgram);
    this.mapBuffers = [];
    this.mapVaos = [];
    this.linePasses = null;
    this.secretSectorPass = null;
    this.damageSectorPass = null;
    this.teleportPass = null;
    this.thingPasses = null;
    this.dartPasses = null;
    this.playerPass = null;
    this.currentMap = null;
  }

  /**
   * Registers a callback for "the context was lost and did not come back".
   * Fires at most once, [CONTEXT_LOST_GRACE_MS] after `webglcontextlost` —
   * never immediately on loss — because `webglcontextrestored` commonly
   * follows a loss within a frame or two (a GPU driver reset, a backgrounded
   * tab), and the caller should not tear down its GL renderer for a blip it
   * recovers from unassisted.
   */
  onContextLost(cb: () => void): void {
    this.lostCallback = cb;
  }

  private handleContextLost = (event: Event): void => {
    // preventDefault is what allows a restoration event to arrive at all —
    // without it the browser treats the loss as terminal for this canvas.
    event.preventDefault();
    if (this.lostTimer !== null) clearTimeout(this.lostTimer);
    this.lostTimer = setTimeout(() => {
      this.lostTimer = null;
      this.lostCallback?.();
    }, CONTEXT_LOST_GRACE_MS);
  };

  private handleContextRestored = (): void => {
    if (this.lostTimer !== null) {
      clearTimeout(this.lostTimer);
      this.lostTimer = null;
    }
    // A restored context invalidates every GL object the old one owned. The
    // stale handles are dropped (not deleted — there is nothing valid left
    // to delete them from) before rebuilding, so uploadMap's own delete loop
    // never runs against them.
    this.mapBuffers = [];
    this.mapVaos = [];
    try {
      this.initContext();
      if (this.currentMap) this.uploadMap(this.currentMap);
    } catch (error) {
      // The grace timer was cleared at the top of this handler, so nothing
      // else can ever fire the fallback: a rebuild that fails has to do it
      // itself. Without this, the caller keeps a renderer whose `draw()`
      // passes its own guards against stale handles and paints nothing — and
      // an `alpha: false` drawing buffer composites opaque black, so the user
      // gets a permanently black map with no way back to the canvas path.
      //
      // Classified exactly as `createGlRenderer` classifies the same two
      // failures: a compile or link failure in this file's own GLSL is a bug
      // and gets the driver's log; a context that simply cannot be had again
      // is the expected, silent fallback.
      if (error instanceof ShaderError) {
        console.error('crustyview: WebGL2 shader init failed after context restore', error.message);
      }
      this.lostCallback?.();
    }
  };
}

/**
 * Non-throwing factory: `null` on any init failure (no WebGL2 context,
 * shader compile, or program link).
 *
 * The two failure kinds are deliberately not treated the same way. No
 * WebGL2 context is silent — an old browser or a disabled GPU is an expected
 * shape of "this device doesn't get the GL path", handled by falling back to
 * canvas without comment. A `ShaderError` — a compile or link failure in
 * *this file's own* GLSL — is not expected on any device and must not look
 * identical to that case, so it is surfaced via `console.error` before
 * returning `null`.
 */
export function createGlRenderer(
  canvas: HTMLCanvasElement,
  opts: GlRendererOptions,
): GlMapRenderer | null {
  try {
    return new GlMapRenderer(canvas, opts);
  } catch (error) {
    if (error instanceof ShaderError) {
      console.error('crustyview: WebGL2 shader init failed', error.message);
    }
    return null;
  }
}
