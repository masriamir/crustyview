<script lang="ts">
  import { summaryRows } from '../format';
  import { wad } from '../stores/wad.svelte';

  const rows = $derived(wad.summary ? summaryRows(wad.summary) : []);
</script>

<section aria-label="Overview">
  <h2>Overview</h2>
  {#if wad.fileName}<p class="file">{wad.fileName}</p>{/if}
  <div class="cards">
    {#each rows as row (row.label)}
      <div class="card">
        <span class="label">{row.label}</span>
        <span class="value">{row.value}</span>
      </div>
    {/each}
  </div>
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
  }
  .file {
    margin: 0 0 1rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 1rem;
  }
  .card {
    display: grid;
    gap: 0.25rem;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .label {
    color: var(--text-muted);
    font-size: 0.8rem;
  }
  .value {
    font-family: var(--font-mono);
    font-size: 1.2rem;
  }
</style>
