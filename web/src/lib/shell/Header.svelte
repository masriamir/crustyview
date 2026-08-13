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
  <button type="button" class="open" title="Open a WAD file — replaces the one currently loaded" onclick={() => input.click()}>Open</button>
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
    /* Px437 has an exact 16-unit grid: only multiples of 16px land on whole
       pixels. 32px is the desktop size; see the compact override below. */
    font-family: var(--font-display);
    font-size: 32px;
    font-weight: 400;
    line-height: 1;
    /* The DOM text stays `crustyview` — the product's name everywhere else —
       so the capitals are presentation, not a rename. */
    text-transform: uppercase;
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
    h1 {
      /* 32px makes the wordmark 180px, which overflows a 360px viewport once
         the Open button (70px), the toggle (44px) and three 1rem gaps are
         counted. 16px is the next grid-clean size down. */
      font-size: 16px;
    }
    .file {
      display: none;
    }
    .open {
      min-height: var(--touch-target);
    }
  }
</style>
