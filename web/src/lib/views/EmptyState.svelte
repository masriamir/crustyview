<script lang="ts">
  import { openWad } from '../stores/open';
  import { wad } from '../stores/wad.svelte';

  let dragging = $state(false);
  let input = $state<HTMLInputElement>();

  function pick(files: FileList | null | undefined): void {
    const file = files?.[0];
    if (file) void openWad(file);
  }
</script>

<div class="empty">
  {#if wad.phase === 'error'}
    <p class="error" role="alert">Error: {wad.error}</p>
  {/if}
  {#if wad.phase === 'loading'}
    <p class="status">Loading…</p>
  {:else}
    <!-- A native button, not a `div[role=button]` with hand-rolled Enter/Space
         handling (#188). The browser supplies activation, focus and the role,
         and the whole dashed area stays the click target. Note the input had to
         move out: a button's content model is phrasing content, so it can hold
         neither the interactive `<input>` nor the `<p>` this text used to sit
         in — both were invalid HTML inside `role="button"` too, just unenforced. -->
    <button
      type="button"
      class="drop"
      class:dragging
      ondragover={(e) => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={(e) => {
        e.stopPropagation();
        e.preventDefault();
        dragging = false;
        pick(e.dataTransfer?.files);
      }}
      onclick={() => input?.click()}
    >
      Drop a WAD anywhere, or click to browse.
    </button>
    <!-- Inert while `hidden` — labeled for the same defense-in-depth reason as
         the header's input; see the note there. -->
    <input
      bind:this={input}
      type="file"
      accept=".wad,.WAD"
      aria-label="Choose a WAD file to open"
      hidden
      onchange={(e) => {
        pick(e.currentTarget.files);
        e.currentTarget.value = '';
      }}
    />
  {/if}
</div>

<style>
  .empty {
    height: 100%;
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1rem;
  }
  .error {
    color: var(--danger);
    font-weight: 600;
  }
  .status {
    color: var(--text-muted);
  }
  .drop {
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    padding: 3rem 2rem;
    min-width: min(24rem, 100%);
    text-align: center;
    cursor: pointer;
    color: var(--text-muted);
    transition: border-color var(--transition);
    /* Button resets: a UA button brings its own font and background, and this
       used to be a div. Without these the copy shrinks to the UA button size
       and the dashed box picks up a grey fill. */
    font: inherit;
    background: none;
  }
  .drop.dragging,
  .drop:hover {
    border-color: var(--accent);
  }
</style>
