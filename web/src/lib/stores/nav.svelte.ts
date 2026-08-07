/** The four top-level sections of the sidebar tree / bottom nav. */
export type Section = 'overview' | 'maps' | 'textures' | 'lumps';

/** Mode switch inside the map view. */
export type MapMode = '2d' | '3d';

/**
 * Navigation state (ADR-0003): state-driven, no URL router. `section` picks
 * the active view; `selectedMap` and `mapMode` drive the map view.
 */
export class NavStore {
  section = $state<Section>('overview');
  selectedMap = $state<string | null>(null);
  mapMode = $state<MapMode>('2d');

  /** Switch section; the map selection survives so returning restores it. */
  goto(section: Section): void {
    this.section = section;
  }

  /** The map-list state of the Maps section (mobile back target). */
  showMapList(): void {
    this.section = 'maps';
    this.selectedMap = null;
  }

  /** Jump to the Maps section with `name` active. */
  selectMap(name: string): void {
    this.section = 'maps';
    this.selectedMap = name;
  }

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
  }

  /** Back to the initial state — called when a new WAD loads. */
  reset(): void {
    this.section = 'overview';
    this.selectedMap = null;
    this.mapMode = '2d';
  }
}

export const nav = new NavStore();
