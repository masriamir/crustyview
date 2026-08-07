<script lang="ts">
  import { wad } from '../stores/wad.svelte';
</script>

<section aria-label="Lumps">
  <h2>Lumps</h2>
  <p class="count">{wad.summary?.lump_count ?? 0} lumps in the directory</p>
  <p class="note">
    The filterable lump table needs a lump-directory query on
    <code>WadDocument</code>; it lands with a later change.
  </p>
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
  }
  .count {
    font-family: var(--font-mono);
  }
  .note {
    color: var(--text-muted);
    max-width: 40rem;
  }
</style>
