<script lang="ts">
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';
</script>

<div class="status-bar" role="status">
  {#if wad.summary}
    <span>{wad.summary.kind}</span>
    <span>{wad.summary.lump_count} lumps</span>
    <span>{wad.summary.map_count} maps</span>
    {#if nav.selectedMap}<span>{nav.selectedMap}</span>{/if}
  {:else}
    <span>No WAD loaded</span>
  {/if}
</div>

<style>
  .status-bar {
    grid-area: status;
    display: flex;
    gap: 1.25rem;
    padding: 0.25rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  @media (max-width: 48rem) {
    .status-bar {
      display: none;
    }
  }
</style>
