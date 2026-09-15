<script lang="ts">
  import { app, type Page } from '../lib/store.svelte';
  import { isDesktop, isMobile, win } from '../lib/platform';
  import Icon from './Icon.svelte';

  const pages: { id: Page; label: string }[] = [
    { id: 'log', label: 'Log' },
    { id: 'trends', label: 'Trends' },
    { id: 'report', label: 'Report' },
  ];
</script>

<header class="bar" class:mobile={isMobile} data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <svg class="mark" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M11 1.6l8.1 4.7v9.4L11 20.4l-8.1-4.7V6.3z" fill="var(--card-3)" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="1" stroke-linejoin="round" />
      <path d="M11 5.6C11.9 8.2 15.1 10.2 15.1 13.2A4.1 4.1 0 0 1 6.9 13.2C6.9 10.2 10.1 8.2 11 5.6Z" fill="var(--accent)" />
      <ellipse cx="9.5" cy="12.6" rx="0.8" ry="1.3" transform="rotate(18 9.5 12.6)" fill="var(--ink)" fill-opacity="0.45" />
    </svg>
    <span class="name" data-tauri-drag-region>Honeycomb</span>
  </div>

  {#if !isMobile}
    <nav class="seg" aria-label="Pages">
      {#each pages as p (p.id)}
        <button type="button" aria-pressed={app.page === p.id} onclick={() => (app.page = p.id)}>{p.label}</button>
      {/each}
    </nav>
  {:else}
    <div></div>
  {/if}

  <div class="right" data-tauri-drag-region>
    {#if app.sync.configured}
      {@const peers = app.sync.snapshot?.peers ?? []}
      {@const anyOnline = peers.some((p) => p.online)}
      <button
        type="button"
        class="icon-btn sync"
        class:busy={app.sync.busy}
        class:offline={!anyOnline && !app.sync.busy}
        title={app.sync.busy ? 'Syncing' : anyOnline ? `Synced with ${peers.filter((p) => p.online).map((p) => p.name).join(', ')}` : 'Other devices not reachable right now'}
        aria-label="Devices"
        onclick={() => (app.settingsOpen = true)}
      >
        <Icon name="devices" />
        <span class="state"></span>
      </button>
    {/if}
    {#if !isMobile}
      <button type="button" class="icon-btn" title="Settings (Ctrl+,)" aria-label="Settings" onclick={() => (app.settingsOpen = true)}>
        <Icon name="gear" />
      </button>
    {/if}
    {#if isDesktop}
      <div class="wc">
        <button type="button" class="wc-btn" title="Minimize" aria-label="Minimize" onclick={() => win.minimize()}>
          <Icon name="minimize" size={14} />
        </button>
        <button
          type="button"
          class="wc-btn"
          title={app.maximized ? 'Restore' : 'Maximize'}
          aria-label={app.maximized ? 'Restore' : 'Maximize'}
          onclick={() => win.toggleMaximize()}
        >
          <Icon name={app.maximized ? 'restore' : 'maximize'} size={13} />
        </button>
        <button type="button" class="wc-btn" title="Close" aria-label="Close" onclick={() => app.closeWindow()}>
          <Icon name="close" size={14} />
        </button>
      </div>
    {/if}
  </div>
</header>

<style>
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    height: 50px;
    padding: 0 10px 0 18px;
    flex: none;
  }
  .bar.mobile {
    height: 52px;
    padding: 0 12px 0 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 100%;
  }
  .mark {
    display: block;
  }
  .name {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 32, 'wdth' 100;
    font-weight: 700;
    font-size: 17px;
    letter-spacing: -0.025em;
    color: var(--ink);
  }
  .right {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    height: 100%;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    color: var(--ink-2);
    transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .icon-btn:hover {
    background: var(--card-2);
    color: var(--ink);
  }
  .sync {
    position: relative;
  }
  .state {
    position: absolute;
    right: 5px;
    bottom: 6px;
    width: 7px;
    height: 8px;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    background: var(--accent);
  }
  .sync.offline .state {
    background: var(--ink-4);
  }
  .sync.busy .state {
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .wc {
    display: flex;
    gap: 2px;
    margin-left: 6px;
    padding-left: 8px;
    border-left: 1px solid var(--line);
  }
  .wc-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    color: var(--ink-2);
    transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .wc-btn:hover {
    background: var(--card-2);
    color: var(--ink);
  }
  @media print {
    .bar {
      display: none;
    }
  }
</style>
