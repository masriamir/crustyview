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
 */
import type { Map2d } from '../../../format';
import { viewportRect } from '../cull';
import {
  DAMAGE_DASH_OFFSET,
  KIND_ORDER,
  KIND_WIDTH,
  OVERLAY_WIDTH,
  SECTOR_DASH,
  TELEPORT_DASH,
  type Palette,
} from '../render';
import type { TeleportLink } from '../teleportArcs';
import type { ThingCategory } from '../things';
import type { Transform } from '../transform';

type LineKind = Map2d['lines'][number]['kind'];

const VERT = `#version 300 es
// aCorner.x: which endpoint (0|1) along the segment. aCorner.y: which side
// (-1|+1) of the centerline. Locations are explicit — the corner buffer
// (location 0) and the per-instance segment buffer (location 1) are shared
// by every pass this renderer draws (base kinds, dashed overlays, grid), so a
// linker-chosen reordering would silently corrupt all of them at once rather
// than failing to compile.
layout(location = 0) in vec2 aCorner;
// Segment endpoints in map units: (x1, y1, x2, y2), one instance per line.
layout(location = 1) in vec4 aSeg;
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
out float vAlong;         // device px along the segment, 0 at its start
out float vAcross;        // device px from the centerline
out float vLen;           // segment length in device px
void main() {
  // mapToScreen (transform.ts): sx = tx + x*scale, sy = ty - y*scale.
  vec2 p0 = (uOffset + vec2(aSeg.x, -aSeg.y) * uScale) * uDpr;
  vec2 p1 = (uOffset + vec2(aSeg.z, -aSeg.w) * uScale) * uDpr;
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
  // Screen y grows downward; clip y grows upward.
  gl_Position = vec4(pos / uViewport * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`;

const FRAG = `#version 300 es
precision highp float;
in float vAlong;
in float vAcross;
in float vLen;
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
    float pos = mod(vAlong / uDpr + uDash.z, period);
    float e = 0.25; // CSS px of AA at dash edges
    aa *= smoothstep(-e, e, pos) * (1.0 - smoothstep(uDash.x - e, uDash.x + e, pos));
  }
  outColor = vec4(uColor.rgb, uColor.a * aa);
}`;

/** on/off/phase, all in CSS px; `on == 0` means the fragment shader treats
 *  the pass as solid (see `uDash` in `FRAG`). */
const SOLID_DASH: readonly [number, number, number] = [0, 0, 0];
const GRID_WIDTH = 1;

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
  /** The shader AA apron (`uFeather`). A live uniform: this can change
   *  between draws without recreating anything. */
  feather: boolean;
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
  /** Pre-culled, pre-capped teleport link arcs. Unused by this task's passes
   *  (things/darts/links are a later task) — carried on the frame now so the
   *  interface does not change shape when that task lands. */
  arcs: readonly TeleportLink[];
}

/** One instanced-quad draw call's worth of GPU state. Colors are
 *  deliberately absent: every pass is colored from `GlFrame.palette` at
 *  draw time, never baked in at load time (see the module doc). */
interface Pass {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
  width: number;
  dash: readonly [number, number, number];
}

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
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
  }
  return shader;
}

/** Compiles and links the one program every pass in this renderer draws
 *  through — base kinds, dashed overlays, and the grid all share it; only
 *  the buffer, uniforms, and draw call vary per pass. */
function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
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

  /** One pass per base line kind, plus the three dashed overlays. All four
   *  are (re)built together by `uploadMap`, so a single null check on
   *  `linePasses` is enough to know whether a map has been loaded yet. */
  private linePasses: Record<LineKind, Pass> | null = null;
  private secretSectorPass: Pass | null = null;
  private damageSectorPass: Pass | null = null;
  private teleportPass: Pass | null = null;
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
    this.program = link(gl);
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
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
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
  }

  /** One VAO wired to the shared corner buffer (location 0, the quad shape)
   *  and a caller-owned instance buffer of `vec4` segments (location 1, one
   *  instance per line). Every pass — base kinds, overlays, grid — is this
   *  same wiring over a different buffer. */
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

  /**
   * Packs the map's lines into per-pass instance buffers and uploads them.
   *
   * `game` feeds `categoryOf` for the thing/glyph passes a later task adds;
   * it is stored and otherwise unused today, so those passes do not need a
   * second `loadMap`-shaped entry point.
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
    return { vao, buffer, count, width, dash };
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

    gl.bindVertexArray(null);
  }

  private drawLineInstances(
    vao: WebGLVertexArrayObject,
    count: number,
    width: number,
    dash: readonly [number, number, number],
    color: Rgb,
  ): void {
    if (count === 0) return;
    const gl = this.gl;
    gl.uniform1f(this.uniforms.uWidth, width);
    gl.uniform4f(this.uniforms.uColor, color[0], color[1], color[2], 1);
    gl.uniform3f(this.uniforms.uDash, dash[0], dash[1], dash[2]);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  /**
   * Builds and draws the grid instance buffer fresh every frame — unlike the
   * map passes, `frame.grid`, the transform, and the viewport can all change
   * on every draw, and even a large map's visible grid tops out at a few
   * hundred lines, so rebuilding is cheap and caching would only add a
   * second invalidation problem to solve. Never call `bufferSubData` here:
   * the instance count itself changes every draw.
   *
   * Bounds mirror `drawGrid` (render.ts): the visible map rect from
   * `viewportRect`, additionally intersected with the map's own bounds so a
   * view that hangs off the edge of a small map does not spend instances on
   * grid lines nothing will ever occupy.
   */
  private drawGridPass(frame: GlFrame): void {
    const map = this.currentMap;
    const step = frame.grid;
    if (map === null || step === null) return;

    const view = viewportRect(frame.transform, frame.widthCss, frame.heightCss, 0);
    const minX = Math.max(view.minX, map.bounds.min_x);
    const maxX = Math.min(view.maxX, map.bounds.max_x);
    const minY = Math.max(view.minY, map.bounds.min_y);
    const maxY = Math.min(view.maxY, map.bounds.max_y);
    if (minX > maxX || minY > maxY) return;

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
    gl.deleteProgram(this.program);
    this.mapBuffers = [];
    this.mapVaos = [];
    this.linePasses = null;
    this.secretSectorPass = null;
    this.damageSectorPass = null;
    this.teleportPass = null;
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
    this.initContext();
    if (this.currentMap) this.uploadMap(this.currentMap);
  };
}

/** Non-throwing factory: `null` on any init failure (no WebGL2 context,
 *  shader compile, or program link). */
export function createGlRenderer(
  canvas: HTMLCanvasElement,
  opts: GlRendererOptions,
): GlMapRenderer | null {
  try {
    return new GlMapRenderer(canvas, opts);
  } catch {
    return null;
  }
}
