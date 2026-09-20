<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { isDesktop } from '../lib/platform';
  import { fmtRelative } from '../lib/time';
  import Icon from './Icon.svelte';
  import PairPanel from './PairPanel.svelte';

  let pairing = $state(false);
  const snap = $derived(app.sync.snapshot);

  function peerLine(p: { syncing: boolean; online: boolean; unpaired: boolean; last_sync: number | null }): string {
    if (p.unpaired) return 'Removed on that device';
    if (p.syncing) return 'Syncing';
    if (p.last_sync) return `Synced ${fmtRelative(p.last_sync, app.now.getTime())}`;
    if (p.online) return 'Connected';
    return 'Not reachable right now';
  }

  async function forget(id: string, name: string): Promise<void> {
    await app.sync.forget(id);
    app.toast(`Removed ${name}`);
  }

  function rename(e: Event): void {
    const value = (e.currentTarget as HTMLInputElement).value.trim();
    if (value) void app.sync.rename(value);
  }
</script>

<section>
  <div class="head">
    <h3>Devices</h3>
    <p>
      Keep readings the same on every computer you use. Devices talk to each other directly with end-to-end encryption.
      There is no account, and nothing is stored on a server.
    </p>
  </div>

  {#if snap}
    <div class="me">
      <span class="lbl">This device is called</span>
      <input class="field name" value={snap.device.name} onchange={rename} maxlength="40" aria-label="Name of this device" />
    </div>

    {#if snap.peers.length}
      <ul class="peers">
        {#each snap.peers as p (p.id)}
          <li>
            <span class="pdot" class:online={p.online || p.syncing} class:busy={p.syncing}></span>
            <span class="pname">{p.name}</span>
            <span class="pstate">{peerLine(p)}</span>
            <button type="button" class="btn small ghost" onclick={() => forget(p.id, p.name)}>Remove</button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if pairing}
      <PairPanel onclose={() => (pairing = false)} />
    {:else}
      <div class="row">
        <button type="button" class="btn small primary" onclick={() => (pairing = true)} disabled={!snap.ready}>
          <Icon name="plus" size={14} /> {snap.peers.length ? 'Pair another device' : 'Pair a device'}
        </button>
        {#if snap.peers.length}
          <button type="button" class="btn small" onclick={() => app.sync.syncNow()}><Icon name="refresh" size={14} /> Sync now</button>
        {/if}
        {#if !snap.ready}
          <span class="pstate">Getting online…</span>
        {/if}
      </div>
    {/if}

    {#if snap.peers.length && isDesktop}
      <label class="toggle">
        <input type="checkbox" checked={app.settings.background} onchange={(e) => app.updateSettings({ background: e.currentTarget.checked })} />
        <span>
          Keep syncing after the window is closed
          <small>Honeycomb stays running quietly. Open it again from the app grid; Ctrl+Q quits fully.</small>
        </span>
      </label>
    {/if}
  {:else if app.sync.error}
    <p class="warn">Sync couldn't start: {app.sync.error}</p>
  {:else}
    <p class="pstate">Starting…</p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  p {
    font-size: 13px;
    color: var(--ink-2);
    max-width: 52ch;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lbl {
    font-size: 13px;
    color: var(--ink-2);
  }
  .name {
    width: 200px;
  }
  .peers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-sm);
    background: var(--card-2);
  }
  .peers li {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 12px;
  }
  .peers li + li {
    border-top: 1px solid var(--line);
  }
  .pdot {
    width: 9px;
    height: 10px;
    clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%);
    background: var(--ink-4);
  }
  .pdot.online {
    background: var(--accent);
  }
  .pdot.busy {
    animation: pulse 1s ease-in-out infinite;
  }
  .pname {
    font-weight: 600;
  }
  .pstate {
    font-size: 12.5px;
    color: var(--ink-3);
    white-space: nowrap;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    cursor: pointer;
  }
  .toggle input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .toggle small {
    display: block;
    color: var(--ink-3);
    font-size: 12px;
    margin-top: 2px;
  }
  .warn {
    color: var(--danger-text);
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
