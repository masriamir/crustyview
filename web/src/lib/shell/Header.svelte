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
  <!-- `hidden` is `display: none`, so this input is neither focusable nor in the
       accessibility tree and the name below is inert today — the adjacent Open
       button is what users reach. It is here as defense in depth: swapping
       `hidden` for the `.visually-hidden` clip (the usual way to make a file
       input keyboard-reachable) would expose an unlabeled control the moment the
       attribute changed, and that change would not look like an a11y edit. -->
  <input
    bind:this={input}
    type="file"
    accept=".wad,.WAD"
    aria-label="Choose a WAD file to open"
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
    /* Web437 has an exact 16-unit grid, so the design targets multiples of 16px
       — 2rem is 32px at the default root. Deliberately `rem` and not `px`: a
       reader who raises their browser's default font size gets the title with
       everything else, and the cost is only that an off-grid root softens the
       glyph edges on 1x displays. See the compact override below. */
    font-family: var(--font-display);
    font-size: 2rem;
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
      /* At 2rem the wordmark is 180px and the whole header 356px, measured —
         which pushes the theme toggle off-screen at or below ~340px, and at
         360px fits only by eating the header's own padding while taking half
         the width. 1rem is the next grid-clean size down. */
      font-size: 1rem;
    }
    .file {
      display: none;
    }
    .open {
      min-height: var(--touch-target);
    }
  }
</style>
