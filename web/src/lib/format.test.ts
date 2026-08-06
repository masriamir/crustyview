import { describe, it, expect } from 'vitest';
import { summaryRows, type WadSummary } from './format';

describe('summaryRows', () => {
  it('formats a full summary in order', () => {
    const s: WadSummary = { kind: 'IWAD', lump_count: 42, map_count: 9, first_map: 'E1M1', game: 'Doom' };
    expect(summaryRows(s)).toEqual([
      { label: 'Kind', value: 'IWAD' },
      { label: 'Lumps', value: '42' },
      { label: 'Maps', value: '9' },
      { label: 'Game', value: 'Doom' },
      { label: 'First map', value: 'E1M1' },
    ]);
  });

  it('renders null game/first_map as an em dash', () => {
    const s: WadSummary = { kind: 'PWAD', lump_count: 0, map_count: 0, first_map: null, game: null };
    const rows = summaryRows(s);
    expect(rows.find((r) => r.label === 'Game')?.value).toBe('—');
    expect(rows.find((r) => r.label === 'First map')?.value).toBe('—');
  });
});
