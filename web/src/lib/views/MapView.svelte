<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Map2d from './map2d/Map2d.svelte';
  import { mapPrefs } from '../stores/mapPrefs.svelte';
  import { nav, type MapMode } from '../stores/nav.svelte';
  import { CATEGORIES, CLASSIC_THING_COLORS, type ThingCategory } from './map2d/things';

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

  /** The mounted 2D map, for the view controls it exports (`refit`, `zoomFactor`). */
  let map2d = $state<Map2d>();
  const zoom = $derived(map2d?.zoomFactor() ?? 1);

  const counts = $derived(map2d?.categoryCounts() ?? null);
  const totalThings = $derived(
    counts === null ? 0 : Object.values(counts).reduce((a, b) => a + b, 0),
  );

  /** Swatch color per the active style, so the chips double as the legend. */
  function swatchColor(id: ThingCategory): string {
    return mapPrefs.style === 'classic' ? CLASSIC_THING_COLORS[id] : `var(--map2d-thing-${id})`;
  }

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
      {#if mapPrefs.showThings && totalThings > 0 && counts !== null}
        <div class="chips" role="group" aria-label="Thing category filters">
          {#each CATEGORIES as category (category.id)}
            <button
              type="button"
              class="chip"
              aria-pressed={mapPrefs.isCategoryShown(category.id)}
              disabled={counts[category.id] === 0}
              onclick={() => mapPrefs.toggleCategory(category.id)}
            >
              <span class="swatch" style:background={swatchColor(category.id)} aria-hidden="true"
              ></span>
              {category.label}
              <span class="count">{counts[category.id]}</span>
            </button>
          {/each}
        </div>
      {/if}
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
  /* One height per bar: match the SegmentedControl's 36px on desktop. ADR-0003's
     ≥44px touch floor is compact-scoped — restored in the 48rem media block. */
  .tool {
    min-width: var(--touch-target);
    min-height: calc(var(--touch-target) - 8px);
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
  .chips {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: calc(var(--touch-target) - 8px);
    padding: 0 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    font-size: 0.85rem;
    transition: background var(--transition);
  }
  /* Off = filtered out: keep the swatch visible but mute the chip. */
  .chip[aria-pressed='false'] {
    color: var(--text-muted);
    background: transparent;
  }
  .chip[aria-pressed='false'] .swatch {
    opacity: 0.35;
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .swatch {
    width: 0.75em;
    height: 0.75em;
    border-radius: 2px;
  }
  .count {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
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
    .tool,
    .chip {
      min-height: var(--touch-target);
    }
  }
</style>
