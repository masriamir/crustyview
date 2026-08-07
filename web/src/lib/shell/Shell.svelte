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
  import { openWad } from '../stores/open';
  import { nav } from '../stores/nav.svelte';
  import { wad } from '../stores/wad.svelte';

  function ondrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void openWad(file);
  }
</script>

<svelte:window ondragover={(e) => e.preventDefault()} ondrop={ondrop} />

<div class="shell">
  <Header />
  <Sidebar />
  <main class="main">
    {#if wad.phase !== 'loaded'}
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
  .main {
    grid-area: main;
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
