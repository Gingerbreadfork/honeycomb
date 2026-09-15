<script lang="ts">
  import { app } from '../lib/store.svelte';
  import Dialog from './Dialog.svelte';

  const req = $derived(app.sync.pairRequest);
</script>

{#if req}
  <Dialog title="Pair with {req.device.name}?" width={400} onclose={() => app.sync.respondPair(req.request_id, false)}>
    <p class="text">
      <strong>{req.device.name}</strong> wants to share readings with this device. Make sure the same code is showing there.
    </p>
    <div class="code">{req.code}</div>
    {#snippet footer()}
      <button type="button" class="btn" onclick={() => app.sync.respondPair(req.request_id, false)}>Not now</button>
      <button type="button" class="btn primary" data-autofocus onclick={() => app.sync.respondPair(req.request_id, true)}>Pair</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .text {
    font-size: 14px;
    color: var(--ink-2);
  }
  .text strong {
    color: var(--ink);
  }
  .code {
    margin-top: 14px;
    font-size: 40px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
