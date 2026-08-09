import { WadDocument } from '../../wasm/crustyview_web.js';
import type { Map2d, Map2dFailure, MapStats, TextureMeta, WadSummary } from '../format';

type Phase = 'empty' | 'loading' | 'loaded' | 'error';

export class WadStore {
  phase = $state<Phase>('empty');
  summary = $state<WadSummary | null>(null);
  mapNames = $state<string[]>([]);
  textureMeta = $state<TextureMeta | null>(null);
  error = $state<string | null>(null);
  fileName = $state<string | null>(null);
  #doc: WadDocument | null = null;
  #loadSeq = 0;
  #map2dCache = new Map<string, { map: Map2d | null; error: string | null }>();
  #mapStatsCache = new Map<string, MapStats | null>();

  async load(file: File): Promise<void> {
    const seq = ++this.#loadSeq;
    this.phase = 'loading';
    this.error = null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (seq === this.#loadSeq) this.#fail('Could not read the file.');
      return;
    }
    // A newer load() started while we awaited the bytes — let it own the state
    // (don't clobber it or free its handle). Everything below here is synchronous.
    if (seq !== this.#loadSeq) return;
    // Free any previously-held WAD before replacing it.
    this.#freeDoc();
    this.#map2dCache.clear();
    this.#mapStatsCache.clear();
    let doc: WadDocument;
    try {
      doc = WadDocument.load(bytes);
    } catch (e) {
      this.#fail(e instanceof Error ? e.message : 'Not a valid WAD.');
      return;
    }
    this.#doc = doc;
    try {
      this.summary = JSON.parse(doc.summary()) as WadSummary;
      this.mapNames = doc.mapNames();
      this.textureMeta = JSON.parse(doc.textureMeta()) as TextureMeta | null;
    } catch (e) {
      // The Rust side emits valid JSON, but a read/parse failure must still fail
      // cleanly — free the handle and surface an error rather than stay stuck in
      // `loading` with a retained WadDocument.
      this.#fail(e instanceof Error ? e.message : 'Could not read the WAD.');
      return;
    }
    this.fileName = file.name;
    this.phase = 'loaded';
  }

  /** RGBA of the first texture, or null when there is none or the buffer is unusable. */
  textureRgba(): Uint8Array | null {
    if (!this.#doc || !this.textureMeta) return null;
    const rgba = this.#doc.textureRgba();
    const { width, height } = this.textureMeta;
    return rgba.length === width * height * 4 ? rgba : null;
  }

  /** Flattened 2D geometry for a map, cached per name; null when unavailable. */
  map2d(name: string): Map2d | null {
    return this.#map2dEntry(name).map;
  }

  /** The user-facing assembly error for `name`, or null when the map loaded. */
  map2dError(name: string): string | null {
    return this.#map2dEntry(name).error;
  }

  mapStats(name: string): MapStats | null {
    if (!this.#doc) return null;
    if (!this.#mapStatsCache.has(name)) {
      try {
        this.#mapStatsCache.set(name, JSON.parse(this.#doc.mapStats(name)) as MapStats | null);
      } catch {
        this.#mapStatsCache.set(name, null);
      }
    }
    return this.#mapStatsCache.get(name) ?? null;
  }

  #map2dEntry(name: string): { map: Map2d | null; error: string | null } {
    if (!this.#doc) return { map: null, error: null };
    let entry = this.#map2dCache.get(name);
    if (entry === undefined) {
      try {
        const parsed = JSON.parse(this.#doc.map2d(name)) as Map2d | Map2dFailure | null;
        entry =
          parsed !== null && 'error' in parsed
            ? { map: null, error: parsed.error }
            : { map: parsed, error: null };
      } catch {
        // Unparseable payload — fall back to the generic alert line.
        entry = { map: null, error: null };
      }
      this.#map2dCache.set(name, entry);
    }
    return entry;
  }

  reset(): void {
    this.#freeDoc();
    this.#map2dCache.clear();
    this.#mapStatsCache.clear();
    this.phase = 'empty';
    this.summary = null;
    this.mapNames = [];
    this.textureMeta = null;
    this.error = null;
    this.fileName = null;
  }

  #fail(message: string): void {
    this.#freeDoc();
    this.#map2dCache.clear();
    this.#mapStatsCache.clear();
    this.phase = 'error';
    this.error = message;
    this.summary = null;
    this.mapNames = [];
    this.textureMeta = null;
    this.fileName = null;
  }

  #freeDoc(): void {
    this.#doc?.free();
    this.#doc = null;
  }
}

export const wad = new WadStore();
