<script lang="ts">
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';

  let mapsExpanded = $state(true);
  const disabled = $derived(wad.phase !== 'loaded');
  const hasMaps = $derived(wad.phase === 'loaded' && wad.mapNames.length > 0);
</script>

<nav class="sidebar" aria-label="Sections">
  <ul>
    <li>
      <button
        type="button"
        {disabled}
        aria-current={nav.section === 'overview' ? 'page' : undefined}
        onclick={() => nav.goto('overview')}
      >
        Overview
      </button>
    </li>
    <li>
      <button
        type="button"
        class="disclosure"
        {disabled}
        aria-expanded={hasMaps ? mapsExpanded : undefined}
        aria-controls={hasMaps ? 'sidebar-map-entries' : undefined}
        onclick={() => (mapsExpanded = !mapsExpanded)}
      >
        Maps
        {#if hasMaps}
          <span class="chevron" aria-hidden="true">{mapsExpanded ? '▾' : '▸'}</span>
        {/if}
      </button>
      {#if hasMaps}
        <ul class="map-entries" id="sidebar-map-entries" hidden={!mapsExpanded}>
          {#each wad.mapNames as name (name)}
            <li>
              <button
                type="button"
                {disabled}
                aria-current={nav.section === 'maps' && nav.selectedMap === name
                  ? 'page'
                  : undefined}
                onclick={() => nav.selectMap(name)}
              >
                {name}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </li>
    <li>
      <button
        type="button"
        {disabled}
        aria-current={nav.section === 'textures' ? 'page' : undefined}
        onclick={() => nav.goto('textures')}
      >
        Textures
      </button>
    </li>
    <li>
      <button
        type="button"
        {disabled}
        aria-current={nav.section === 'lumps' ? 'page' : undefined}
        onclick={() => nav.goto('lumps')}
      >
        Lumps
      </button>
    </li>
  </ul>
</nav>

<style>
  .sidebar {
    grid-area: sidebar;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    padding: 0.5rem;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    display: flex;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 0.4rem 0.6rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    color: var(--text);
    cursor: pointer;
    transition: background var(--transition);
  }
  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  button:disabled {
    color: var(--text-muted);
    cursor: default;
  }
  button[aria-current='page'] {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--nav-current);
    font-weight: 600;
  }
  .disclosure .chevron {
    margin-left: auto;
    color: var(--text-muted);
  }
  .map-entries {
    padding-left: 0.9rem;
  }
  .map-entries button {
    font-family: var(--font-mono);
    font-size: 0.9rem;
  }
  @media (max-width: 48rem) {
    .sidebar {
      display: none;
    }
  }
</style>
