<script lang="ts">
  import { app } from './lib/store.svelte';
  import { isDesktop, isMobile, isTauri, win, type ResizeDirection } from './lib/platform';
  import TabBar from './components/TabBar.svelte';
  import TitleBar from './components/TitleBar.svelte';
  import Toasts from './components/Toasts.svelte';
  import PairRequestDialog from './components/PairRequestDialog.svelte';
  import ImportDialog from './components/ImportDialog.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import EditReading from './components/EditReading.svelte';
  import LogPage from './pages/LogPage.svelte';
  import TrendsPage from './pages/TrendsPage.svelte';
  import ReportPage from './pages/ReportPage.svelte';

  void app.init();

  if (isMobile) {
    (window as unknown as { __honeycombBack: () => boolean }).__honeycombBack = () => {
      if (app.sync.pairRequest) {
        app.sync.respondPair(app.sync.pairRequest.request_id, false);
        return true;
      }
      if (app.importing) {
        app.importing = null;
        return true;
      }
      if (app.editing) {
        app.editing = null;
        return true;
      }
      if (app.settingsOpen) {
        app.settingsOpen = false;
        return true;
      }
      if (app.page !== 'log') {
        app.page = 'log';
        return true;
      }
      return false;
    };
  }

  const edges: [ResizeDirection, string][] = [
    ['North', 'n'],
    ['South', 's'],
    ['East', 'e'],
    ['West', 'w'],
    ['NorthEast', 'ne'],
    ['NorthWest', 'nw'],
    ['SouthEast', 'se'],
    ['SouthWest', 'sw'],
  ];

  function onkeydown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      app.page = (['log', 'trends', 'report'] as const)[Number(e.key) - 1];
      e.preventDefault();
    } else if (e.key === ',') {
      app.settingsOpen = true;
      e.preventDefault();
    } else if (e.key === 'q') {
      app.quit();
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

<div class="app" class:tauri={isDesktop} class:mobile={isMobile} class:maximized={app.maximized}>
  <TitleBar />
  <main>
    {#if app.startError || app.loadError}
      <div class="trouble" role="alert">
        <h2 class="display">{app.startError ? "Honeycomb couldn't start" : "Your readings file couldn't be read"}</h2>
        <p>{app.startError ?? app.loadError}</p>
        {#if app.loadError}
          <p class="muted">{app.dataPath}</p>
          <p class="muted">Nothing will be saved until it can be read, so the file is left as it is.</p>
          <button type="button" class="btn primary" onclick={() => app.loadReadings()}>Try again</button>
        {/if}
      </div>
    {:else if app.ready}
      {#key app.page}
        <div class="page">
          {#if app.page === 'log'}
            <LogPage />
          {:else if app.page === 'trends'}
            <TrendsPage />
          {:else}
            <ReportPage />
          {/if}
        </div>
      {/key}
    {/if}
  </main>

  {#if isMobile}
    <TabBar />
  {/if}

  {#if app.settingsOpen}
    <SettingsDialog onclose={() => (app.settingsOpen = false)} />
  {/if}
  {#if app.editing}
    {#key app.editing.id}
      <EditReading reading={app.editing} onclose={() => (app.editing = null)} />
    {/key}
  {/if}
  <PairRequestDialog />
  <ImportDialog />
  <Toasts />

  {#if isDesktop && !app.maximized}
    {#each edges as [dir, cls] (cls)}
      <div class="edge {cls}" role="presentation" onpointerdown={() => void win.startResize(dir)}></div>
    {/each}
  {/if}
</div>

<style>
  .app {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--paper);
    overflow: hidden;
  }
  .app.tauri {
    border-radius: var(--radius-window);
    box-shadow: inset 0 0 0 1px var(--frame);
  }
  .app.tauri.maximized {
    border-radius: 0;
    box-shadow: none;
  }
  .app.mobile {
    padding-top: env(safe-area-inset-top);
  }
  main {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .page {
    position: absolute;
    inset: 0;
    animation: rise-in var(--t-slow) var(--ease-out);
  }
  .trouble {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    max-width: 60ch;
    margin: 0 auto;
    padding: 64px 24px;
  }
  .trouble h2 {
    font-size: 22px;
  }
  .trouble p {
    overflow-wrap: anywhere;
  }
  .trouble .btn {
    margin-top: 8px;
  }
  .edge {
    position: absolute;
    z-index: 90;
  }
  .edge.n,
  .edge.s {
    left: 8px;
    right: 8px;
    height: 5px;
    cursor: ns-resize;
  }
  .edge.n {
    top: 0;
  }
  .edge.s {
    bottom: 0;
  }
  .edge.e,
  .edge.w {
    top: 8px;
    bottom: 8px;
    width: 5px;
    cursor: ew-resize;
  }
  .edge.e {
    right: 0;
  }
  .edge.w {
    left: 0;
  }
  .edge.ne,
  .edge.nw,
  .edge.se,
  .edge.sw {
    width: 10px;
    height: 10px;
  }
  .edge.ne {
    top: 0;
    right: 0;
    cursor: nesw-resize;
  }
  .edge.nw {
    top: 0;
    left: 0;
    cursor: nwse-resize;
  }
  .edge.se {
    bottom: 0;
    right: 0;
    cursor: nwse-resize;
  }
  .edge.sw {
    bottom: 0;
    left: 0;
    cursor: nesw-resize;
  }

  @media print {
    .app,
    .app.tauri {
      height: auto;
      overflow: visible;
      border-radius: 0;
      box-shadow: none;
      background: #fff;
    }
    main {
      position: static;
    }
    .page {
      position: static;
      animation: none;
    }
    .edge {
      display: none;
    }
  }
</style>
