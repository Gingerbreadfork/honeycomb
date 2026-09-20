<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { copyText } from '../lib/platform';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let mode = $state<'show' | 'enter'>('show');
  let code = $state('');
  let expires = $state(0);
  let entered = $state('');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let copied = $state(false);

  const snap = $derived(app.sync.snapshot);
  const nearby = $derived(snap?.nearby.filter((n) => !n.paired) ?? []);
  const remaining = $derived(Math.max(1, Math.ceil((expires - app.now.getTime()) / 60000)));
  const expired = $derived(code !== '' && expires <= app.now.getTime());

  async function showCode(): Promise<void> {
    error = null;
    try {
      const p = await app.sync.startPairing();
      code = p.code;
      expires = p.expires;
    } catch (e) {
      error = String(e);
    }
  }

  function stop(): void {
    app.sync.cancelPairing();
    onclose();
  }

  async function copy(): Promise<void> {
    await copyText(code);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function pairEntered(): Promise<void> {
    if (!entered.trim() || busy) return;
    busy = 'Connecting…';
    error = null;
    try {
      const device = await app.sync.pairWith(entered);
      app.toast(`Paired with ${device.name}`);
      onclose();
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  async function pairNearby(id: string, name: string): Promise<void> {
    if (busy) return;
    busy = `Waiting for ${name} to accept…`;
    error = null;
    try {
      const device = await app.sync.pairNearby(id);
      app.toast(`Paired with ${device.name}`);
      onclose();
    } catch (e) {
      error = String(e);
    } finally {
      busy = null;
    }
  }

  function start(): void {
    void showCode();
  }
</script>

<div class="panel" {@attach start}>
  <div class="top">
    <div class="seg">
      <button type="button" aria-pressed={mode === 'show'} onclick={() => (mode = 'show')}>Show a code</button>
      <button type="button" aria-pressed={mode === 'enter'} onclick={() => (mode = 'enter')}>Enter a code</button>
    </div>
    <button type="button" class="btn small ghost" onclick={stop}>Cancel</button>
  </div>

  {#if mode === 'show'}
    <p class="hint">On the other computer, open Settings, choose Pair a device, then Enter a code.</p>
    {#if expired}
      <div class="row">
        <span class="muted">That code has expired.</span>
        <button type="button" class="btn small" onclick={showCode}>Show a new code</button>
      </div>
    {:else if code}
      <div class="code" aria-label="Pairing code">{code}</div>
      <div class="row">
        <button type="button" class="btn small" onclick={copy}><Icon name="copy" size={14} /> {copied ? 'Copied' : 'Copy code'}</button>
        <span class="muted">Works once, for {remaining} more minute{remaining === 1 ? '' : 's'}.</span>
      </div>
    {:else if !error}
      <p class="muted">Preparing a code…</p>
    {/if}
  {:else}
    <p class="hint">Paste the code shown on the other computer.</p>
    <textarea
      class="field entry"
      rows="3"
      bind:value={entered}
      placeholder="xxxx-xxxx-xxxx…"
      spellcheck="false"
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void pairEntered();
        }
      }}
    ></textarea>
    <div class="row">
      <button type="button" class="btn small primary" onclick={pairEntered} disabled={!entered.trim() || busy !== null}>
        {busy ?? 'Pair'}
      </button>
    </div>
  {/if}

  {#if nearby.length}
    <div class="nearby">
      <span class="lbl">On this network</span>
      <ul>
        {#each nearby as n (n.id)}
          <li>
            <Icon name="devices" size={15} />
            <span class="nname">{n.name}</span>
            <button type="button" class="btn small" onclick={() => pairNearby(n.id, n.name)} disabled={busy !== null}>Pair</button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if app.sync.pairConfirm}
    {@const ask = app.sync.pairConfirm}
    <div class="waiting">
      <span>{ask.device.name} accepted. Was it showing this code?</span>
      <span class="confirm">{ask.code}</span>
    </div>
    <div class="row">
      <button type="button" class="btn small primary" onclick={() => app.sync.respondPair(ask.request_id, true)}>Yes, pair</button>
      <button type="button" class="btn small" onclick={() => app.sync.respondPair(ask.request_id, false)}>No, cancel</button>
    </div>
  {:else if busy && app.sync.waitingCode}
    <div class="waiting">
      <span>{busy} Check the same code appears there.</span>
      <span class="confirm">{app.sync.waitingCode}</span>
    </div>
  {:else if busy && mode === 'show'}
    <p class="muted">{busy}</p>
  {/if}
  {#if error}
    <p class="error">{error}</p>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--card-2);
    animation: pop-in var(--t-med) var(--ease-spring);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hint {
    font-size: 13px;
    color: var(--ink-2);
  }
  .code {
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    letter-spacing: 0.04em;
    line-height: 1.6;
    word-break: break-all;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--paper);
    user-select: text;
    -webkit-user-select: text;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .muted {
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .entry {
    width: 100%;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.03em;
  }
  .nearby {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }
  .lbl {
    font-size: 12.5px;
    color: var(--ink-2);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  li :global(svg) {
    color: var(--ink-2);
  }
  .nname {
    flex: 1;
    font-weight: 600;
  }
  .error {
    font-size: 13px;
    color: var(--danger-text);
  }
  .waiting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .confirm {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
</style>
