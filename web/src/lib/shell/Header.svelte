<script lang="ts">
  import ThemeToggle from '../ui/ThemeToggle.svelte';
  import { openWad } from '../stores/open';
  import { wad } from '../stores/wad.svelte';

  let input: HTMLInputElement;
</script>

<header class="header">
  <h1>crustyview</h1>
  {#if wad.phase === 'loaded' && wad.fileName}<span class="file">{wad.fileName}</span>{/if}
  <span class="spacer"></span>
  <button type="button" class="open" onclick={() => input.click()}>Open</button>
  <input
    bind:this={input}
    type="file"
    accept=".wad,.WAD"
    hidden
    onchange={(e) => {
      const file = e.currentTarget.files?.[0];
      if (file) void openWad(file);
      e.currentTarget.value = '';
    }}
  />
  <ThemeToggle />
</header>

<style>
  .header {
    grid-area: header;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
  }
  h1 {
    margin: 0;
    font-size: 1.1rem;
  }
  .file {
    font-family: var(--font-mono);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .open {
    min-height: calc(var(--touch-target) - 8px);
    padding: 0 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-contrast);
    cursor: pointer;
    font-weight: 600;
  }
  @media (max-width: 48rem) {
    .file {
      display: none;
    }
    .open {
      min-height: var(--touch-target);
    }
  }
</style>
