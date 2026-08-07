<script lang="ts">
  import { wad } from './lib/stores/wad.svelte';
  import { theme } from './lib/stores/theme.svelte';
  import FileDrop from './lib/FileDrop.svelte';
  import StatsPanel from './lib/StatsPanel.svelte';
  import TexturePreview from './lib/TexturePreview.svelte';

  $effect(() => {
    document.documentElement.dataset.theme = theme.resolved;
  });
</script>

<main>
  <header>
    <h1>crustyview</h1>
    <FileDrop onfile={(f) => wad.load(f)} />
  </header>

  {#if wad.phase === 'error'}
    <p class="error" role="alert">Error: {wad.error}</p>
  {:else if wad.phase === 'loading'}
    <p class="status">Loading…</p>
  {:else if wad.phase === 'loaded' && wad.summary}
    <div class="panels">
      <StatsPanel summary={wad.summary} mapNames={wad.mapNames} fileName={wad.fileName} />
      <TexturePreview meta={wad.textureMeta} rgba={() => wad.textureRgba()} />
    </div>
  {:else}
    <p class="status">Drop a WAD to begin.</p>
  {/if}
</main>
