import { CATEGORIES, type ThingCategory } from '../views/map2d/things';

const STORAGE_KEY = 'crustyview-map-prefs';

/** Map rendering style: themed to match the app palette, or classic Doom colors. */
export type MapStyle = 'theme' | 'classic';

interface StoredMapPrefs {
  showThings: boolean;
  showGrid: boolean;
  style: MapStyle;
  hiddenThingCategories: string[];
}

const DEFAULTS: StoredMapPrefs = {
  showThings: true,
  showGrid: false,
  style: 'theme',
  hiddenThingCategories: [],
};

const allVisible = (): Record<ThingCategory, boolean> =>
  Object.fromEntries(CATEGORIES.map((c) => [c.id, true])) as Record<ThingCategory, boolean>;

/**
 * 2D map view preferences (ADR-0003): things/grid visibility and render
 * style, persisted to `localStorage` so they survive reloads.
 */
export class MapPrefsStore {
  showThings = $state(DEFAULTS.showThings);
  showGrid = $state(DEFAULTS.showGrid);
  style = $state<MapStyle>(DEFAULTS.style);
  showCategories = $state<Record<ThingCategory, boolean>>(allVisible());

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Blocked storage (private mode, storage disabled) — fall back to defaults.
    }
    if (stored === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const v = parsed as Record<string, unknown>;
    if (typeof v.showThings === 'boolean') this.showThings = v.showThings;
    if (typeof v.showGrid === 'boolean') this.showGrid = v.showGrid;
    if (v.style === 'theme' || v.style === 'classic') this.style = v.style;
    if (Array.isArray(v.hiddenThingCategories)) {
      for (const id of v.hiddenThingCategories) {
        if (typeof id === 'string' && id in this.showCategories) {
          this.showCategories[id as ThingCategory] = false;
        }
      }
    }
  }

  toggleThings(): void {
    this.showThings = !this.showThings;
    this.#persist();
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.#persist();
  }

  toggleStyle(): void {
    this.style = this.style === 'theme' ? 'classic' : 'theme';
    this.#persist();
  }

  isCategoryShown(id: ThingCategory): boolean {
    return this.showCategories[id];
  }

  toggleCategory(id: ThingCategory): void {
    this.showCategories[id] = !this.showCategories[id];
    this.#persist();
  }

  #persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          showThings: this.showThings,
          showGrid: this.showGrid,
          style: this.style,
          hiddenThingCategories: CATEGORIES.filter((c) => !this.showCategories[c.id]).map(
            (c) => c.id,
          ),
        } satisfies StoredMapPrefs),
      );
    } catch {
      // Blocked storage — the change still applies for this session.
    }
  }
}

export const mapPrefs = new MapPrefsStore();
