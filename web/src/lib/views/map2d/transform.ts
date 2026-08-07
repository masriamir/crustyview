import type { Map2d } from '../../format';

export interface Transform {
  scale: number;
  tx: number;
  ty: number;
}

/** Map-space → screen-space; map Y points north, screen Y points down. */
export function mapToScreen(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: t.tx + x * t.scale, y: t.ty - y * t.scale };
}

export function screenToMap(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: (x - t.tx) / t.scale, y: (t.ty - y) / t.scale };
}

/** Fit bounds into width×height with a margin; degenerate bounds get scale 1. */
export function fitTransform(
  bounds: Map2d['bounds'],
  width: number,
  height: number,
  margin = 24,
): Transform {
  const w = bounds.max_x - bounds.min_x;
  const h = bounds.max_y - bounds.min_y;
  const scale =
    w > 0 && h > 0
      ? Math.min((width - 2 * margin) / w, (height - 2 * margin) / h)
      : 1;
  const cx = (bounds.min_x + bounds.max_x) / 2;
  const cy = (bounds.min_y + bounds.max_y) / 2;
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 + cy * scale };
}

/** Zoom by factor toward a screen anchor, clamping scale to [min, max]. */
export function zoomAt(
  t: Transform,
  screenX: number,
  screenY: number,
  factor: number,
  min: number,
  max: number,
): Transform {
  const scale = Math.min(max, Math.max(min, t.scale * factor));
  const k = scale / t.scale;
  return {
    scale,
    tx: screenX - (screenX - t.tx) * k,
    ty: screenY - (screenY - t.ty) * k,
  };
}

export function panBy(t: Transform, dx: number, dy: number): Transform {
  return { scale: t.scale, tx: t.tx + dx, ty: t.ty + dy };
}
