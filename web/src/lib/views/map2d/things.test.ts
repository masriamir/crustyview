import { describe, it, expect } from 'vitest';
import { CATEGORIES, categoryOf, countByCategory } from './things';

describe('categoryOf', () => {
  it('classifies representative vanilla doomednums', () => {
    expect(categoryOf(3001, null)).toBe('monsters'); // imp
    expect(categoryOf(9, null)).toBe('monsters'); // shotgun guy
    expect(categoryOf(16, null)).toBe('monsters'); // cyberdemon
    expect(categoryOf(65, null)).toBe('monsters'); // chaingunner (Doom2)
    expect(categoryOf(2001, null)).toBe('weapons'); // shotgun
    expect(categoryOf(82, null)).toBe('weapons'); // super shotgun (Doom2)
    expect(categoryOf(2048, null)).toBe('ammo'); // box of bullets
    expect(categoryOf(8, null)).toBe('ammo'); // backpack
    expect(categoryOf(2012, null)).toBe('health'); // medikit
    expect(categoryOf(2019, null)).toBe('health'); // megaarmor (armor folds into health)
    expect(categoryOf(83, null)).toBe('health'); // megasphere (Doom2)
    expect(categoryOf(2023, null)).toBe('powerups'); // berserk
    expect(categoryOf(2026, null)).toBe('powerups'); // computer area map
    expect(categoryOf(5, null)).toBe('keys'); // blue keycard
    expect(categoryOf(38, null)).toBe('keys'); // red skull key
    expect(categoryOf(14, null)).toBe('teleports'); // teleport destination
    expect(categoryOf(2035, null)).toBe('decorations'); // exploding barrel
    expect(categoryOf(2028, null)).toBe('decorations'); // floor lamp
    expect(categoryOf(49, null)).toBe('decorations'); // hanging victim
  });

  it('maps starts and unknowns to other', () => {
    for (const id of [1, 2, 3, 4, 11]) expect(categoryOf(id, null)).toBe('other');
    expect(categoryOf(0, null)).toBe('other');
    expect(categoryOf(9999, null)).toBe('other');
    expect(categoryOf(-1, null)).toBe('other');
  });

  it('skips the Doom table entirely for Strife WADs', () => {
    expect(categoryOf(3001, 'Strife')).toBe('other');
    expect(categoryOf(2001, 'Strife')).toBe('other');
    expect(categoryOf(14, 'Strife')).toBe('other');
  });
});

describe('countByCategory', () => {
  it('totals per category, including zero entries', () => {
    const things = [
      { type_id: 3001 },
      { type_id: 3004 },
      { type_id: 2001 },
      { type_id: 14 },
      { type_id: 1 },
    ];
    const counts = countByCategory(things, null);
    expect(counts.monsters).toBe(2);
    expect(counts.weapons).toBe(1);
    expect(counts.teleports).toBe(1);
    expect(counts.other).toBe(1);
    expect(counts.keys).toBe(0);
    expect(Object.keys(counts).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });

  it('counts everything as other for Strife', () => {
    const counts = countByCategory([{ type_id: 3001 }, { type_id: 2001 }], 'Strife');
    expect(counts.other).toBe(2);
    expect(counts.monsters).toBe(0);
  });
});
