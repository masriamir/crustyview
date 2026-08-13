import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, textureMetaJson } = vi.hoisted(() => ({
  calls: { textureMeta: 0 },
  textureMetaJson: { value: '{"name":"TEX1","width":8,"height":8}' },
}));

vi.mock('../../wasm/crustyview_web.js', () => ({
  WadDocument: {
    load: vi.fn(() => ({
      summary: () => '{"kind":"PWAD","lump_count":0,"map_count":0,"game":null}',
      mapNames: () => [],
      textureMeta: () => {
        calls.textureMeta += 1;
        return textureMetaJson.value;
      },
      textureRgba: () => new Uint8Array(8 * 8 * 4),
      free: () => {},
    })),
  },
}));

import { WadStore } from './wad.svelte';

/** A File whose bytes `load()` can read under happy-dom. */
function wadFile(name = 'a.wad'): File {
  return new File([new Uint8Array([1, 2, 3])], name);
}

describe('WadStore.textureMeta', () => {
  beforeEach(() => {
    calls.textureMeta = 0;
    textureMetaJson.value = '{"name":"TEX1","width":8,"height":8}';
  });

  it('queries the wasm export once and caches the result', async () => {
    const store = new WadStore();
    await store.load(wadFile());

    expect(calls.textureMeta).toBe(0); // not computed during load
    expect(store.textureMeta()).toEqual({ name: 'TEX1', width: 8, height: 8 });
    expect(store.textureMeta()).toEqual({ name: 'TEX1', width: 8, height: 8 });
    expect(calls.textureMeta).toBe(1);
  });

  it('caches a null result without re-querying', async () => {
    textureMetaJson.value = 'null';
    const store = new WadStore();
    await store.load(wadFile());

    expect(store.textureMeta()).toBeNull();
    expect(store.textureMeta()).toBeNull();
    expect(calls.textureMeta).toBe(1);
  });

  it('caches null when the payload will not parse', async () => {
    textureMetaJson.value = 'not json';
    const store = new WadStore();
    await store.load(wadFile());

    // Two reads: a single call can't distinguish a cached null from a fresh
    // re-query (both return null), so the call-count assertion below only
    // proves caching if the second read is here too.
    expect(store.textureMeta()).toBeNull();
    expect(store.textureMeta()).toBeNull();
    expect(calls.textureMeta).toBe(1);
  });

  it('returns null without querying after reset clears the document', async () => {
    const store = new WadStore();
    await store.load(wadFile());
    expect(store.textureMeta()).not.toBeNull();

    store.reset();
    // `reset()` clears `#doc`; `textureMeta()` short-circuits on the
    // null-document guard before ever consulting the cache, so this does
    // NOT exercise cache invalidation — see the "re-queries after a
    // replacement load" test below for that.
    expect(store.textureMeta()).toBeNull();
    expect(calls.textureMeta).toBe(1);
  });

  it('re-queries after a replacement load', async () => {
    const store = new WadStore();
    await store.load(wadFile('a.wad'));
    expect(store.textureMeta()).toEqual({ name: 'TEX1', width: 8, height: 8 });

    textureMetaJson.value = '{"name":"TEX2","width":16,"height":16}';
    await store.load(wadFile('b.wad'));
    expect(store.textureMeta()).toEqual({ name: 'TEX2', width: 16, height: 16 });
    expect(calls.textureMeta).toBe(2);
  });
});

describe('WadStore.loadingFileName', () => {
  it('names the incoming file while loading, and clears when loaded', async () => {
    const store = new WadStore();
    const pending = store.load(wadFile('incoming.wad'));
    expect(store.loadingFileName).toBe('incoming.wad');

    await pending;
    expect(store.loadingFileName).toBeNull();
    expect(store.fileName).toBe('incoming.wad');
  });
});

describe('WadStore.load return value', () => {
  it('resolves true when the load commits', async () => {
    const store = new WadStore();
    await expect(store.load(wadFile())).resolves.toBe(true);
    expect(store.phase).toBe('loaded');
  });

  it('resolves false when the WAD is invalid', async () => {
    const store = new WadStore();
    const { WadDocument } = await import('../../wasm/crustyview_web.js');
    vi.mocked(WadDocument.load).mockImplementationOnce(() => {
      throw new Error('Not a valid WAD.');
    });

    await expect(store.load(wadFile())).resolves.toBe(false);
    expect(store.phase).toBe('error');
  });

  it('resolves false for a superseded load and true for the winner', async () => {
    // This is the case `openWad` gates on: a stale load must not report success
    // and reset navigation out from under the load that actually committed.
    const store = new WadStore();
    const first = store.load(wadFile('a.wad'));
    const second = store.load(wadFile('b.wad'));

    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(store.fileName).toBe('b.wad');
  });
});
