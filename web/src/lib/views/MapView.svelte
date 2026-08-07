<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Map2d from './map2d/Map2d.svelte';
  import { nav, type MapMode } from '../stores/nav.svelte';

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

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
  </div>
  {#if nav.mapMode === '2d'}
    <Map2d {name} />
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
    gap: 1rem;
  }
  .bar h2 {
    margin: 0;
    font-family: var(--font-mono);
    flex: 1;
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
