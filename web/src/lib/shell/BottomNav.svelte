<script lang="ts">
  import { nav, type Section } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';

  const items: { section: Section; label: string; icon: string }[] = [
    { section: 'overview', label: 'Overview', icon: '⌂' },
    { section: 'maps', label: 'Maps', icon: '▦' },
    { section: 'textures', label: 'Textures', icon: '▤' },
    { section: 'lumps', label: 'Lumps', icon: '≡' },
  ];

  function tap(section: Section): void {
    if (section === 'maps' && nav.section === 'maps') nav.showMapList();
    else nav.goto(section);
  }
</script>

<nav class="bottom-nav" aria-label="Sections">
  {#each items as item (item.section)}
    <button
      type="button"
      disabled={wad.phase !== 'loaded'}
      aria-current={nav.section === item.section ? 'page' : undefined}
      onclick={() => tap(item.section)}
    >
      <span class="icon" aria-hidden="true">{item.icon}</span>
      <span class="label">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    grid-area: nav;
    display: none;
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    padding-bottom: env(safe-area-inset-bottom);
  }
  button {
    display: grid;
    justify-items: center;
    gap: 0.1rem;
    min-height: var(--touch-target);
    padding: 0.35rem 0;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  button[aria-current='page'] {
    color: var(--accent);
  }
  button:disabled {
    color: color-mix(in srgb, var(--text-muted) 50%, transparent);
    cursor: default;
  }
  .icon {
    font-size: 1.2rem;
    line-height: 1;
  }
  .label {
    font-size: 0.7rem;
  }
  @media (max-width: 48rem) {
    .bottom-nav {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
    }
  }
</style>
