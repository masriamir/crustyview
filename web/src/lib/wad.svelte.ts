import { WadDocument } from '../wasm/crustyview_web.js';
import type { TextureMeta, WadSummary } from './format';

type Phase = 'empty' | 'loading' | 'loaded' | 'error';

class WadStore {
  phase = $state<Phase>('empty');
  summary = $state<WadSummary | null>(null);
  mapNames = $state<string[]>([]);
  textureMeta = $state<TextureMeta | null>(null);
  error = $state<string | null>(null);
  #doc: WadDocument | null = null;

  async load(file: File): Promise<void> {
    this.phase = 'loading';
    this.error = null;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      this.#fail('Could not read the file.');
      return;
    }
    // Free any previously-held WAD before replacing it.
    this.#freeDoc();
    let doc: WadDocument;
    try {
      doc = WadDocument.load(bytes);
    } catch (e) {
      this.#fail(e instanceof Error ? e.message : 'Not a valid WAD.');
      return;
    }
    this.#doc = doc;
    this.summary = JSON.parse(doc.summary()) as WadSummary;
    this.mapNames = doc.mapNames();
    this.textureMeta = JSON.parse(doc.textureMeta()) as TextureMeta | null;
    this.phase = 'loaded';
  }

  /** RGBA of the first texture, or null when there is none or the buffer is unusable. */
  textureRgba(): Uint8Array | null {
    if (!this.#doc || !this.textureMeta) return null;
    const rgba = this.#doc.textureRgba();
    const { width, height } = this.textureMeta;
    return rgba.length === width * height * 4 ? rgba : null;
  }

  reset(): void {
    this.#freeDoc();
    this.phase = 'empty';
    this.summary = null;
    this.mapNames = [];
    this.textureMeta = null;
    this.error = null;
  }

  #fail(message: string): void {
    this.#freeDoc();
    this.phase = 'error';
    this.error = message;
    this.summary = null;
    this.mapNames = [];
    this.textureMeta = null;
  }

  #freeDoc(): void {
    this.#doc?.free();
    this.#doc = null;
  }
}

export const wad = new WadStore();
