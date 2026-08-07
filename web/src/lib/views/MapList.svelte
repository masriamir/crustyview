<script lang="ts">
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';
</script>

<section aria-label="Maps">
  <h2>Maps ({wad.mapNames.length})</h2>
  {#if wad.mapNames.length === 0}
    <p class="note">This WAD contains no maps.</p>
  {:else}
    <ul class="maps">
      {#each wad.mapNames as name (name)}
        <li>
          <button type="button" onclick={() => nav.selectMap(name)}>{name}</button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
  }
  .note {
    color: var(--text-muted);
  }
  .maps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
    gap: 0.5rem;
  }
  .maps button {
    width: 100%;
    min-height: var(--touch-target);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    font-family: var(--font-mono);
    cursor: pointer;
    transition: border-color var(--transition);
  }
  .maps button:hover {
    border-color: var(--accent);
  }
</style>
