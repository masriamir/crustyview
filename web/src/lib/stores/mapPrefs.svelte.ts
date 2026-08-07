const STORAGE_KEY = 'crustyview-map-prefs';

/** Map rendering style: themed to match the app palette, or classic Doom colors. */
export type MapStyle = 'theme' | 'classic';

interface StoredMapPrefs {
  showThings: boolean;
  showGrid: boolean;
  style: MapStyle;
}

const DEFAULTS: StoredMapPrefs = {
  showThings: true,
  showGrid: false,
  style: 'theme',
};

/**
 * 2D map view preferences (ADR-0003): things/grid visibility and render
 * style, persisted to `localStorage` so they survive reloads.
 */
export class MapPrefsStore {
  showThings = $state(DEFAULTS.showThings);
  showGrid = $state(DEFAULTS.showGrid);
  style = $state<MapStyle>(DEFAULTS.style);

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

  #persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          showThings: this.showThings,
          showGrid: this.showGrid,
          style: this.style,
        } satisfies StoredMapPrefs),
      );
    } catch {
      // Blocked storage — the change still applies for this session.
    }
  }
}

export const mapPrefs = new MapPrefsStore();
