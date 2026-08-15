import { DEFAULT_GRID_SIZE, isGridSize, type GridSize } from '../views/map2d/grid';
import {
  DEFAULT_TELEPORT_ARC_CAP,
  isTeleportArcCap,
  type TeleportArcCap,
} from '../views/map2d/teleportArcs';
import { CATEGORIES, type ThingCategory } from '../views/map2d/things';

const STORAGE_KEY = 'crustyview-map-prefs';

/** Map rendering style: themed to match the app palette, or classic Doom colors. */
export type MapStyle = 'theme' | 'classic';

interface StoredMapPrefs {
  showThings: boolean;
  showGrid: boolean;
  style: MapStyle;
  hiddenThingCategories: string[];
  showTeleportLines: boolean;
  showSecretSectors: boolean;
  showDamagingSectors: boolean;
  alwaysShowPlayerStart: boolean;
  gridSize: GridSize;
  showTeleportArcs: boolean;
  teleportArcCap: TeleportArcCap;
}

const DEFAULTS: StoredMapPrefs = {
  showThings: true,
  showGrid: false,
  style: 'theme',
  hiddenThingCategories: [],
  showTeleportLines: true,
  showSecretSectors: false,
  showDamagingSectors: false,
  alwaysShowPlayerStart: true,
  gridSize: DEFAULT_GRID_SIZE,
  showTeleportArcs: true,
  teleportArcCap: DEFAULT_TELEPORT_ARC_CAP,
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
  showTeleportLines = $state(DEFAULTS.showTeleportLines);
  showSecretSectors = $state(DEFAULTS.showSecretSectors);
  showDamagingSectors = $state(DEFAULTS.showDamagingSectors);
  alwaysShowPlayerStart = $state(DEFAULTS.alwaysShowPlayerStart);
  gridSize = $state<GridSize>(DEFAULT_GRID_SIZE);
  /** The teleport ARC overlay — the source linedefs are `showTeleportLines`.
   *  Two preferences because they are two independent passes: on a link-dense
   *  map the useful combination is sources marked and arcs suppressed, which
   *  one shared toggle could not express (#154). */
  showTeleportArcs = $state(DEFAULTS.showTeleportArcs);
  teleportArcCap = $state<TeleportArcCap>(DEFAULTS.teleportArcCap);
  showCategories = $state<Record<ThingCategory, boolean>>(allVisible());

  /** The player-1 arrow draws when things are shown or the always-show pref is on. */
  get showPlayerStart(): boolean {
    return this.showThings || this.alwaysShowPlayerStart;
  }

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
    if (typeof v.showTeleportLines === 'boolean') this.showTeleportLines = v.showTeleportLines;
    if (typeof v.showSecretSectors === 'boolean') this.showSecretSectors = v.showSecretSectors;
    if (typeof v.showDamagingSectors === 'boolean')
      this.showDamagingSectors = v.showDamagingSectors;
    if (typeof v.alwaysShowPlayerStart === 'boolean')
      this.alwaysShowPlayerStart = v.alwaysShowPlayerStart;
    if (isGridSize(v.gridSize)) this.gridSize = v.gridSize;
    if (typeof v.showTeleportArcs === 'boolean') this.showTeleportArcs = v.showTeleportArcs;
    if (isTeleportArcCap(v.teleportArcCap)) this.teleportArcCap = v.teleportArcCap;
    if (Array.isArray(v.hiddenThingCategories)) {
      for (const id of v.hiddenThingCategories) {
        // Own-property check: `in` would also accept prototype keys ("toString"),
        // letting crafted storage graft junk keys onto the record.
        if (typeof id === 'string' && Object.hasOwn(this.showCategories, id)) {
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

  toggleTeleportLines(): void {
    this.showTeleportLines = !this.showTeleportLines;
    this.#persist();
  }

  toggleTeleportArcs(): void {
    this.showTeleportArcs = !this.showTeleportArcs;
    this.#persist();
  }

  setTeleportArcCap(cap: TeleportArcCap): void {
    this.teleportArcCap = cap;
    this.#persist();
  }

  toggleSecretSectors(): void {
    this.showSecretSectors = !this.showSecretSectors;
    this.#persist();
  }

  toggleDamagingSectors(): void {
    this.showDamagingSectors = !this.showDamagingSectors;
    this.#persist();
  }

  toggleAlwaysShowPlayerStart(): void {
    this.alwaysShowPlayerStart = !this.alwaysShowPlayerStart;
    this.#persist();
  }

  setGridSize(size: GridSize): void {
    this.gridSize = size;
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
          showTeleportLines: this.showTeleportLines,
          showSecretSectors: this.showSecretSectors,
          showDamagingSectors: this.showDamagingSectors,
          alwaysShowPlayerStart: this.alwaysShowPlayerStart,
          gridSize: this.gridSize,
          showTeleportArcs: this.showTeleportArcs,
          teleportArcCap: this.teleportArcCap,
        } satisfies StoredMapPrefs),
      );
    } catch {
      // Blocked storage — the change still applies for this session.
    }
  }
}

export const mapPrefs = new MapPrefsStore();
