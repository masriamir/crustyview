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
    <div
      class="drop"
      class:dragging
      role="button"
      tabindex="0"
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
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input?.click();
        }
      }}
    >
      <p>Drop a WAD anywhere, or click to browse.</p>
      <input
        bind:this={input}
        type="file"
        accept=".wad,.WAD"
        hidden
        onchange={(e) => {
          pick(e.currentTarget.files);
          e.currentTarget.value = '';
        }}
      />
    </div>
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
  }
  .drop.dragging,
  .drop:hover {
    border-color: var(--accent);
  }
</style>
