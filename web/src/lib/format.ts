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
