<script lang="ts">
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Map2d from './map2d/Map2d.svelte';
  import { mapPrefs } from '../stores/mapPrefs.svelte';
  import { nav, type MapMode } from '../stores/nav.svelte';
  import { gridDrawnSuffix, gridLabel, type GridSize } from './map2d/grid';
  import { arcCapLabel, arcCapName } from './map2d/teleportArcs';
  import {
    CATEGORIES,
    CATEGORY_DESCRIPTIONS,
    CLASSIC_THING_COLORS,
    type ThingCategory,
  } from './map2d/things';
  import {
    CLASSIC_LINE_SECTOR_DAMAGE,
    CLASSIC_LINE_SECTOR_SECRET,
    CLASSIC_LINE_TELEPORT,
  } from './map2d/lines';

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

  /** The mounted 2D map, for the view controls it exports (`refit`, `zoomFactor`). */
  let map2d = $state<Map2d>();
  const zoom = $derived(map2d?.zoomFactor() ?? 1);

  /**
   * What Map2d actually draws: `undefined` when nothing is known (no draw has
   * resolved a transform yet, or the last one bailed out), `null` when even the
   * largest ladder member is too dense at this zoom.
   */
  let drawnGridSize = $state<GridSize | null | undefined>(undefined);

  // Three states, deliberately distinct: while nothing is known, show the plain
  // size rather than flash the below-the-floor label at someone who has not
  // zoomed anywhere — on a map open, or on a map that failed to assemble (#76).
  const gridLabelText = $derived(gridLabel(mapPrefs.gridSize, drawnGridSize));

  const counts = $derived(map2d?.categoryCounts() ?? null);
  const totalThings = $derived(
    counts === null ? 0 : Object.values(counts).reduce((a, b) => a + b, 0),
  );

  const teleportLines = $derived(map2d?.teleportLineCount() ?? null);
  const sectorCounts = $derived(map2d?.sectorCounts() ?? null);
  const linkTotal = $derived(map2d?.linkCount() ?? null);

  /** Swatch color per the active style, so the chips double as the legend. */
  function swatchColor(id: ThingCategory): string {
    return mapPrefs.style === 'classic' ? CLASSIC_THING_COLORS[id] : `var(--map2d-thing-${id})`;
  }

  /** Swatch for the teleport-lines chip, per the active style. */
  function teleportSwatchColor(): string {
    return mapPrefs.style === 'classic' ? CLASSIC_LINE_TELEPORT : 'var(--map2d-line-teleport)';
  }

  /** Swatches for the sector overlay chips, per the active style. */
  function secretSwatchColor(): string {
    return mapPrefs.style === 'classic'
      ? CLASSIC_LINE_SECTOR_SECRET
      : 'var(--map2d-line-sector-secret)';
  }
  function damageSwatchColor(): string {
    return mapPrefs.style === 'classic'
      ? CLASSIC_LINE_SECTOR_DAMAGE
      : 'var(--map2d-line-sector-damage)';
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
          title="Show thing markers — Player 1's start can stay visible on its own"
          aria-pressed={mapPrefs.showThings}
          aria-label="Show things"
          onclick={() => mapPrefs.toggleThings()}
        >
          Things
        </button>
        <button
          type="button"
          class="tool"
          title="Show the grid — spacing in map units, [ and ] change it; drawn coarser when too dense at this zoom"
          aria-pressed={mapPrefs.showGrid}
          aria-label={`Show grid, ${mapPrefs.gridSize}${gridDrawnSuffix(mapPrefs.gridSize, drawnGridSize)}`}
          onclick={() => mapPrefs.toggleGrid()}
        >
          Grid · {gridLabelText}
        </button>
        <button
          type="button"
          class="tool"
          title="Show teleport links — the arcs pairing each teleporter with its destination; , and . change how many draw. The Teleport lines chip marks the sources separately."
          aria-pressed={linkTotal === 0 ? undefined : mapPrefs.showTeleportArcs}
          aria-disabled={linkTotal === 0 ? true : undefined}
          aria-label={arcCapName(mapPrefs.teleportArcCap, linkTotal)}
          onclick={() => {
            if (linkTotal !== 0) mapPrefs.toggleTeleportArcs();
          }}
        >
          Links · {arcCapLabel(mapPrefs.teleportArcCap, linkTotal)}
        </button>
        <button
          type="button"
          class="tool"
          title="Color the map like the classic automap — instead of the theme's palette"
          aria-pressed={mapPrefs.style === 'classic'}
          aria-label="Classic Doom colors"
          onclick={() => mapPrefs.toggleStyle()}
        >
          Classic
        </button>
        <button
          type="button"
          class="tool"
          title="Always show the player 1 start arrow — when off, it follows the Things toggle"
          aria-pressed={mapPrefs.alwaysShowPlayerStart}
          aria-label="Always show player start"
          onclick={() => mapPrefs.toggleAlwaysShowPlayerStart()}
        >
          Start
        </button>
        <button
          type="button"
          class="tool"
          title="Fit the whole map in view — also 0, or a double-click on the map"
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
            {@const count = counts[category.id]}
            <button
              type="button"
              class="chip"
              aria-pressed={count === 0 ? undefined : mapPrefs.isCategoryShown(category.id)}
              aria-disabled={count === 0 ? true : undefined}
              title={count === 0
                ? `No ${category.label.toLowerCase()} on this map`
                : CATEGORY_DESCRIPTIONS[category.id]}
              onclick={() => {
                if (count > 0) mapPrefs.toggleCategory(category.id);
              }}
            >
              <span class="swatch" style:background={swatchColor(category.id)} aria-hidden="true"
              ></span>
              {category.label}{#if count === 0}
                <span class="visually-hidden">— No {category.label.toLowerCase()} on this map</span
                >
              {/if}
              <span class="count">{count}</span>
            </button>
          {/each}
        </div>
      {/if}
      {#if (teleportLines !== null && teleportLines > 0) || (sectorCounts !== null && (sectorCounts.secrets > 0 || sectorCounts.damage > 0))}
        <div class="chips" role="group" aria-label="Line overlay filters">
          {#if teleportLines !== null && teleportLines > 0}
            <button
              type="button"
              class="chip"
              title="Linedefs carrying a teleport special — the sources; the Teleports chip marks the destinations"
              aria-pressed={mapPrefs.showTeleportLines}
              onclick={() => mapPrefs.toggleTeleportLines()}
            >
              <span class="swatch" style:background={teleportSwatchColor()} aria-hidden="true"
              ></span>
              Teleport lines
              <span class="count">{teleportLines}</span>
            </button>
          {/if}
          {#if sectorCounts !== null && sectorCounts.secrets > 0}
            <button
              type="button"
              class="chip"
              title="Sectors marked secret — the intermission tally counts each one"
              aria-pressed={mapPrefs.showSecretSectors}
              onclick={() => mapPrefs.toggleSecretSectors()}
            >
              <span class="swatch" style:background={secretSwatchColor()} aria-hidden="true"
              ></span>
              Secrets
              <span class="count">{sectorCounts.secrets}</span>
            </button>
          {/if}
          {#if sectorCounts !== null && sectorCounts.damage > 0}
            <button
              type="button"
              class="chip"
              title="Sectors that hurt the player — 5%, 10% or 20% damage per tick"
              aria-pressed={mapPrefs.showDamagingSectors}
              onclick={() => mapPrefs.toggleDamagingSectors()}
            >
              <span class="swatch" style:background={damageSwatchColor()} aria-hidden="true"
              ></span>
              Damage
              <span class="count">{sectorCounts.damage}</span>
            </button>
          {/if}
        </div>
      {/if}
    {/if}
  </div>
  {#if nav.mapMode === '2d'}
    <Map2d {name} bind:this={map2d} bind:drawnGridSize />
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
  /* Mirrors .chip[aria-disabled='true']: a zero-link map leaves the button
     focusable (no `disabled` attribute — #74) but visibly inert. */
  .tool[aria-disabled='true'] {
    color: var(--text-muted);
    cursor: not-allowed;
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
  .chip[aria-disabled='true'] {
    color: var(--text-muted);
    cursor: not-allowed;
  }
  .chip[aria-disabled='true'] .swatch {
    opacity: 0.35;
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
