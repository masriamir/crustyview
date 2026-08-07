/** Map-space cursor position while hovering the 2D map (ADR-0003 status slot). */
export class MapCursorStore {
  pos = $state<{ x: number; y: number } | null>(null);

  set(x: number, y: number): void {
    this.pos = { x, y };
  }

  clear(): void {
    this.pos = null;
  }
}

export const mapCursor = new MapCursorStore();
