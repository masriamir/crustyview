import { WadDocument } from '../../wasm/crustyview_web.js';
import type { Map2d, Map2dFailure, MapStats, TextureMeta, WadSummary } from '../format';

type Phase = 'empty' | 'loading' | 'loaded' | 'error';

export class WadStore {
  phase = $state<Phase>('empty');
  summary = $state<WadSummary | null>(null);
  mapNames = $state<string[]>([]);
  error = $state<string | null>(null);
  fileName = $state<string | null>(null);
  loadingFileName = $state<string | null>(null);
  #doc: WadDocument | null = null;
  #loadSeq = 0;
  #map2dCache = new Map<string, { map: Map2d | null; error: string | null }>();
  #mapStatsCache = new Map<string, MapStats | null>();
  #textureMetaCache: { value: TextureMeta | null } | null = null;

  /**
   * Load a WAD, replacing any currently open one. Resolves `true` only when this
   * call committed — i.e. reached `phase = 'loaded'`. A superseded or failed load
   * resolves `false`, which is what lets `openWad` correct navigation without a
   * stale call clobbering a newer one's state.
   */
  async load(file: File): Promise<boolean> {
    const seq = ++this.#loadSeq;
    this.phase = 'loading';
    this.loadingFileName = file.name;
    this.error = null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      if (seq === this.#loadSeq) this.#fail('Could not read the file.');
      return false;
    }
    // A newer load() started while we awaited the bytes — let it own the state
    // (don't clobber it or free its handle). Everything below here is synchronous.
    if (seq !== this.#loadSeq) return false;
    // Free any previously-held WAD before replacing it.
    this.#freeDoc();
    this.#map2dCache.clear();
    this.#mapStatsCache.clear();
    this.#textureMetaCache = null;
    let doc: WadDocument;
    try {
      doc = WadDocument.load(bytes);
    } catch (e) {
      this.#fail(e instanceof Error ? e.message : 'Not a valid WAD.');
      return false;
    }
    this.#doc = doc;
    try {
      this.summary = JSON.parse(doc.summary()) as WadSummary;
      this.mapNames = doc.mapNames();
    } catch (e) {
      // The Rust side emits valid JSON, but a read/parse failure must still fail
      // cleanly — free the handle and surface an error rather than stay stuck in
      // `loading` with a retained WadDocument.
      this.#fail(e instanceof Error ? e.message : 'Could not read the WAD.');
      return false;
    }
    this.fileName = file.name;
    this.loadingFileName = null;
    this.phase = 'loaded';
    return true;
  }

  /**
   * First texture's name and dimensions, computed once per load; null when the
   * WAD has none. Lazy because it is only ever read by the Textures view, and
   * parsing the texture set dominates open time on large WADs (#57).
   */
  textureMeta(): TextureMeta | null {
    if (!this.#doc) return null;
    // The object wrapper is the sentinel: `null` is a legitimate answer (a WAD
    // with no textures) and must not re-trigger the wasm call on every read.
    if (this.#textureMetaCache === null) {
      let value: TextureMeta | null;
      try {
        value = JSON.parse(this.#doc.textureMeta()) as TextureMeta | null;
      } catch {
        value = null;
      }
      this.#textureMetaCache = { value };
    }
    return this.#textureMetaCache.value;
  }

  /** RGBA of the first texture, or null when there is none or the buffer is unusable. */
  textureRgba(): Uint8Array | null {
    const meta = this.textureMeta();
    if (!this.#doc || !meta) return null;
    const rgba = this.#doc.textureRgba();
    const { width, height } = meta;
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

  /** Record counts for `name`, cached per map; null when missing or unassemblable. */
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
    this.#textureMetaCache = null;
    this.loadingFileName = null;
    this.phase = 'empty';
    this.summary = null;
    this.mapNames = [];
    this.error = null;
    this.fileName = null;
  }

  #fail(message: string): void {
    this.#freeDoc();
    this.#map2dCache.clear();
    this.#mapStatsCache.clear();
    this.#textureMetaCache = null;
    this.loadingFileName = null;
    this.phase = 'error';
    this.error = message;
    this.summary = null;
    this.mapNames = [];
    this.fileName = null;
  }

  #freeDoc(): void {
    this.#doc?.free();
    this.#doc = null;
  }
}

export const wad = new WadStore();
