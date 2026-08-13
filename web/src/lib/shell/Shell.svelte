<script lang="ts">
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';
  import StatusBar from './StatusBar.svelte';
  import BottomNav from './BottomNav.svelte';
  import EmptyState from '../views/EmptyState.svelte';
  import Overview from '../views/Overview.svelte';
  import MapList from '../views/MapList.svelte';
  import MapView from '../views/MapView.svelte';
  import TextureBrowser from '../views/TextureBrowser.svelte';
  import LumpBrowser from '../views/LumpBrowser.svelte';
  import LoadingOverlay from '../views/LoadingOverlay.svelte';
  import { openWad } from '../stores/open';
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';

  function ondrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void openWad(file);
  }

  // Keep the previous WAD's view mounted while a replacement loads: tearing it
  // down showed a one-frame `EmptyState` flash on every replacement (#57).
  // `summary` still holds the outgoing WAD's data until the new one commits,
  // and `Overview` reads only plain data, so nothing renders against the freed
  // document handle.
  const showContent = $derived(
    wad.phase === 'loaded' || (wad.phase === 'loading' && wad.summary !== null),
  );

  // Inertness is tied to the overlay being *visible*, not to the load. The
  // overlay is deliberately invisible for its first 250ms, and making the
  // content behind it unusable during that window is the exact bug that delay
  // prevents (#57, #125).
  let overlayRevealed = $state(false);
  const showOverlay = $derived(wad.phase === 'loading' && showContent);
</script>

<svelte:window ondragover={(e) => e.preventDefault()} ondrop={ondrop} />

<div class="shell">
  <Header />
  <Sidebar />
  <div class="main-area">
    <main class="main" inert={showOverlay && overlayRevealed}>
      {#if !showContent}
        <EmptyState />
      {:else if nav.section === 'overview'}
        <Overview />
      {:else if nav.section === 'maps'}
        {#if nav.selectedMap}
          <MapView name={nav.selectedMap} />
        {:else}
          <MapList />
        {/if}
      {:else if nav.section === 'textures'}
        <TextureBrowser />
      {:else}
        <LumpBrowser />
      {/if}
    </main>
    {#if showOverlay}
      <LoadingOverlay bind:revealed={overlayRevealed} />
    {/if}
  </div>
  <StatusBar />
  <BottomNav />
</div>

<style>
  .shell {
    display: grid;
    grid-template-areas:
      'header header'
      'sidebar main'
      'status status';
    grid-template-columns: 13rem minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    height: 100dvh;
  }
  .main-area {
    grid-area: main;
    position: relative;
    overflow: hidden;
  }
  .main {
    height: 100%;
    overflow: auto;
    padding: 1.5rem;
  }
  @media (max-width: 48rem) {
    .shell {
      grid-template-areas:
        'header'
        'main'
        'nav';
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto minmax(0, 1fr) auto;
    }
    .main {
      padding: 1rem;
    }
  }
</style>
