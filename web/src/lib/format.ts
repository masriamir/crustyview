/** JSON shape returned by `WadDocument.summary()`. */
export interface WadSummary {
  kind: string;
  lump_count: number;
  map_count: number;
  first_map: string | null;
  game: string | null;
}

/** JSON shape returned by `WadDocument.textureMeta()` (or `null`). */
export interface TextureMeta {
  name: string;
  width: number;
  height: number;
}

/** JSON shape returned by `WadDocument.map2d(name)` on success; failures
 * return a [`Map2dFailure`] envelope instead. */
export interface Map2d {
  name: string;
  bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
  lines: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    kind: 'one_sided' | 'two_sided' | 'secret';
    teleport?: boolean;
    secret_sector?: boolean;
    damaging_sector?: boolean;
  }[];
  things: { x: number; y: number; angle: number; type_id: number }[];
  secret_sectors: number;
  damaging_sectors: number;
}

/** Failure envelope `WadDocument.map2d(name)` returns instead of map JSON. */
export interface Map2dFailure {
  error: string;
}

/** JSON shape returned by `WadDocument.mapStats(name)` (or `null`). */
export interface MapStats {
  things: number;
  vertexes: number;
  linedefs: number;
  sidedefs: number;
  sectors: number;
  segs: number;
  subsectors: number;
  nodes: number;
}

/** A label/value pair for the stats panel. */
export interface StatRow {
  label: string;
  value: string;
}

/** Formatted rows for the stats panel; nulls render as an em dash. */
export function summaryRows(summary: WadSummary): StatRow[] {
  return [
    { label: 'Kind', value: summary.kind },
    { label: 'Lumps', value: String(summary.lump_count) },
    { label: 'Maps', value: String(summary.map_count) },
    { label: 'Game', value: summary.game ?? '—' },
    { label: 'First map', value: summary.first_map ?? '—' },
  ];
}
