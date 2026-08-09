<script lang="ts">
  import { version } from '../../wasm/crustyview_web.js';
  import { BUILD_SHA, formatBuild } from '../buildInfo';
  import { mapCursor } from '../stores/mapCursor.svelte';
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';

  // `wad.mapStats` caches behind non-reactive fields — depend on `phase`
  // explicitly, same discipline as the map view's derives.
  const stats = $derived.by(() => {
    void wad.phase;
    return nav.selectedMap ? wad.mapStats(nav.selectedMap) : null;
  });
  // One string, built here rather than in markup, so formatting can't wrap
  // a label away from its count.
  const statsText = $derived(
    stats === null
      ? null
      : `THINGS ${stats.things} · VERTEXES ${stats.vertexes} · LINEDEFS ${stats.linedefs} · SECTORS ${stats.sectors}`,
  );
  // Constant for the life of the page: main.ts awaits wasm init before mounting.
  const build = formatBuild(version(), BUILD_SHA);
</script>

<div class="status-bar">
  <!-- The live region is an inner element, not the bar itself: the build string
       is static and must not be swept into load announcements. -->
  <div class="live" role="status">
    {#if wad.phase === 'loaded' && wad.summary}
      <span>{wad.summary.kind}</span>
      <span>{wad.summary.lump_count} lumps</span>
      <span>{wad.summary.map_count} maps</span>
      {#if nav.selectedMap}<span>{nav.selectedMap}</span>{/if}
      {#if nav.selectedMap && statsText}
        <span class="stats">{statsText}</span>
      {/if}
      <!-- `aria-hidden`: this bar is a polite live region, and the coordinates change
           on every hover move — announcing them would talk over everything else. They
           are a visual readout for a pointer-only interaction, so nothing is lost. -->
      {#if mapCursor.pos}<span aria-hidden="true">({mapCursor.pos.x}, {mapCursor.pos.y})</span>{/if}
    {:else if wad.phase === 'loading'}
      <span>Loading…</span>
    {:else}
      <span>No WAD loaded</span>
    {/if}
  </div>
  <!-- Outside the phase conditional on purpose: a build identifier is most
       useful when a load has just failed and it's going into a bug report.
       One `.visually-hidden` span carries the full "Build v…" announcement
       (no whitespace juggling between a label and a value), and the visible
       text sits in its own `aria-hidden` span so it stays plain-text
       targetable without relying on `aria-label` — a bare `<span>` has the
       implicit `role=generic`, and ARIA 1.2 forbids accessible names on
       `generic`, so an `aria-label` there is not reliably honored. -->
  <span class="build">
    <span class="visually-hidden">Build {build}</span>
    <span class="build-text" aria-hidden="true">{build}</span>
  </span>
</div>

<style>
  .stats {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    /* Keep every label·count pair on one line even on a narrow desktop bar. */
    white-space: nowrap;
  }
  .status-bar {
    grid-area: status;
    display: flex;
    gap: 1.25rem;
    padding: 0.25rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg-raised);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
  /* The live region carries the layout the bar itself used to. */
  .live {
    display: flex;
    gap: 1.25rem;
  }
  /* Pushed to the trailing edge so it never jostles as status content changes. */
  .build {
    margin-left: auto;
    white-space: nowrap;
  }
  @media (max-width: 48rem) {
    .status-bar {
      display: none;
    }
  }
</style>
