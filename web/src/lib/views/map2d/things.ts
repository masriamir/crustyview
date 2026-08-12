/** Thing marker categories for the 2D map filter (#34), in chip order. */
export type ThingCategory =
  | 'monsters'
  | 'weapons'
  | 'ammo'
  | 'health'
  | 'powerups'
  | 'keys'
  | 'teleports'
  | 'decorations'
  | 'other';

/**
 * Chip order and (reversed) canvas draw order — the single source of truth.
 * Monsters sit first so they paint last, on top of overlapping markers.
 */
export const CATEGORIES: readonly { id: ThingCategory; label: string }[] = [
  { id: 'monsters', label: 'Monsters' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'ammo', label: 'Ammo' },
  { id: 'health', label: 'Health' },
  { id: 'powerups', label: 'Powerups' },
  { id: 'keys', label: 'Keys' },
  { id: 'teleports', label: 'Teleports' },
  { id: 'decorations', label: 'Decorations' },
  { id: 'other', label: 'Other' },
];

/**
 * Classic-style marker colors (source-port automap tradition; vanilla drew one
 * color). Shades avoid the meanings already on screen: walls own the pure red,
 * secret lines the bright yellow, the player arrow the pure green.
 */
export const CLASSIC_THING_COLORS: Record<ThingCategory, string> = {
  monsters: '#ff375f',
  weapons: '#ff9f0a',
  ammo: '#c8a765',
  health: '#63e6be',
  powerups: '#bf5af2',
  keys: '#64d2ff',
  teleports: '#5e5ce6',
  decorations: '#8e8e93',
  other: '#c7c7cc',
};

/**
 * Hover/description text for categories whose membership is not obvious from the
 * label. Deliberately partial: monsters, weapons, ammo and keys are self-evident,
 * and a tooltip restating a clear label is noise (#74).
 *
 * Three of these encode facts that live in `TABLE` and nowhere on screen — that
 * `health` also holds armour, that `other` is where player starts and every
 * Strife thing land, and which end of a teleport `teleports` refers to.
 */
export const CATEGORY_DESCRIPTIONS: Partial<Record<ThingCategory, string>> = {
  health: 'Health and armour pickups — bonuses and the megasphere included',
  powerups: 'Spheres and artifacts — invulnerability, berserk, radiation suit, and the like',
  teleports: 'Teleport destination pads — the sources are under Teleport lines',
  decorations: 'Scenery and set dressing — corpses, lamps, and the exploding barrel',
  other:
    'Unclassified things — player and deathmatch starts land here, as does everything in a Strife WAD',
};

/** The table's key space: every category except the `other` fallback. */
type TableCategory = Exclude<ThingCategory, 'other'>;

/**
 * Vanilla Doom/Doom2 doomednums (the two share one numbering space). Absent
 * ids — player/deathmatch starts (1–4, 11) and anything from another game —
 * fall through to `other`.
 */
const TABLE: Record<TableCategory, number[]> = {
  monsters: [
    7, 9, 16, 58, 64, 65, 66, 67, 68, 69, 71, 72, 84, 88, 89, 3001, 3002, 3003, 3004, 3005, 3006,
  ],
  weapons: [82, 2001, 2002, 2003, 2004, 2005, 2006],
  ammo: [8, 17, 2007, 2008, 2010, 2046, 2047, 2048, 2049],
  health: [83, 2011, 2012, 2013, 2014, 2015, 2018, 2019],
  powerups: [2022, 2023, 2024, 2025, 2026, 2045],
  keys: [5, 6, 13, 38, 39, 40],
  teleports: [14],
  decorations: [
    10, 12, 15, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 59, 60, 61, 62, 63, 70,
    73, 74, 75, 76, 77, 78, 79, 80, 81, 85, 86, 2028, 2035,
  ],
};

const BY_ID = new Map<number, ThingCategory>();
for (const [category, ids] of Object.entries(TABLE) as [TableCategory, number[]][]) {
  for (const id of ids) BY_ID.set(id, category);
}

/**
 * Category for a thing's doomednum. Strife reuses the numeric space with
 * different meanings — and is the only game `detect_game()` fingerprints — so
 * a Strife WAD skips the table. Heretic/Hexen are indistinguishable from Doom
 * today and will misclassify; accepted per #34.
 */
export function categoryOf(typeId: number, game: string | null): ThingCategory {
  if (game === 'Strife') return 'other';
  return BY_ID.get(typeId) ?? 'other';
}

/** Per-category totals for the chip counts; every category key is present. */
export function countByCategory(
  things: readonly { type_id: number }[],
  game: string | null,
): Record<ThingCategory, number> {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])) as Record<
    ThingCategory,
    number
  >;
  for (const thing of things) counts[categoryOf(thing.type_id, game)] += 1;
  return counts;
}
