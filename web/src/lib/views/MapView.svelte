<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Map2d from './map2d/Map2d.svelte';
  import { mapPrefs } from '../stores/mapPrefs.svelte';
  import { nav, type MapMode } from '../stores/nav.svelte';

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

  /** The mounted 2D map, for the view controls it exports (`refit`, `zoomFactor`). */
  let map2d = $state<Map2d>();
  const zoom = $derived(map2d?.zoomFactor() ?? 1);

  const modeOptions: {
    value: MapMode;
    label: string;
    disabled?: boolean;
    disabledReason?: string;
  }[] = [
    { value: '2d', label: '2D' },
    {
      value: '3d',
      label: '3D',
      disabled: true,
      disabledReason: 'The 3D viewport arrives with phase 3',
    },
  ];
</script>

<section class="map-view" aria-label={`Map ${name}`}>
  <div class="bar">
    <button
      type="button"
      class="back"
      onclick={() => nav.showMapList()}
      aria-label="Back to the map list"
    >
      ←
    </button>
    <h2>{name}</h2>
    <SegmentedControl
      label="Map mode"
      options={modeOptions}
      value={nav.mapMode}
      onchange={(mode) => nav.setMapMode(mode)}
    />
    {#if nav.mapMode === '2d'}
      <div class="tools" role="group" aria-label="2D map view controls">
        <button
          type="button"
          class="tool"
          aria-pressed={mapPrefs.showThings}
          aria-label="Show things"
          onclick={() => mapPrefs.toggleThings()}
        >
          Things
        </button>
        <button
          type="button"
          class="tool"
          aria-pressed={mapPrefs.showGrid}
          aria-label="Show grid"
          onclick={() => mapPrefs.toggleGrid()}
        >
          Grid
        </button>
        <button
          type="button"
          class="tool"
          aria-pressed={mapPrefs.style === 'classic'}
          aria-label="Classic Doom colors"
          onclick={() => mapPrefs.toggleStyle()}
        >
          Classic
        </button>
        <button
          type="button"
          class="tool"
          aria-label="Fit the map to the view"
          onclick={() => map2d?.refit()}
        >
          Fit
        </button>
        <span class="zoom" title="Zoom, relative to the fitted view">×{zoom.toFixed(1)}</span>
      </div>
    {/if}
  </div>
  {#if nav.mapMode === '2d'}
    <Map2d {name} bind:this={map2d} />
  {:else}
    <div class="placeholder"><p>The 3D viewport arrives with phase 3.</p></div>
  {/if}
</section>

<style>
  .map-view {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 1rem;
  }
  .bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }
  .bar h2 {
    margin: 0;
    font-family: var(--font-mono);
    flex: 1;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  /* Full 44px targets: these are the map's touch controls (ADR-0003). */
  .tool {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
    transition: background var(--transition);
  }
  .tool[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-contrast);
  }
  .zoom {
    /* Fixed width so the bar doesn't twitch as the digits change during a zoom. */
    min-width: 3.5rem;
    text-align: right;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
  .back {
    display: none;
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    font-size: 1.1rem;
  }
  .placeholder {
    display: grid;
    place-items: center;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    min-height: 12rem;
  }
  @media (max-width: 48rem) {
    .back {
      display: inline-flex;
    }
  }
</style>
