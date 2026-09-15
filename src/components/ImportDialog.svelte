<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatValue } from '../lib/glucose';
  import { fmtShortDate } from '../lib/time';
  import Dialog from './Dialog.svelte';

  const job = $derived(app.importing);
  const fresh = $derived(job ? job.plan.add.filter((r) => !r.deleted) : []);
  const span = $derived.by(() => {
    if (!fresh.length) return '';
    const times = fresh.map((r) => r.time.getTime());
    const a = new Date(Math.min(...times));
    const b = new Date(Math.max(...times));
    return a.toDateString() === b.toDateString() ? fmtShortDate(a) : `${fmtShortDate(a)} to ${fmtShortDate(b)}`;
  });
  const unit = $derived(app.settings.unit);
</script>

{#if job}
  <Dialog title="Import readings" width={440} onclose={() => (app.importing = null)}>
    <p class="file">{job.name}</p>
    {#if job.plan.total === 0}
      <p class="text">No readings were found in this file. Honeycomb expects a CSV with a time column and a glucose column.</p>
    {:else if fresh.length === 0}
      <p class="text">
        Everything in this file is already here. {job.plan.total} reading{job.plan.total === 1 ? '' : 's'} checked, nothing new.
      </p>
    {:else}
      <p class="text">
        <strong>{fresh.length} new reading{fresh.length === 1 ? '' : 's'}</strong> from {span}.
        {#if job.plan.existing}{job.plan.existing} already here will be skipped.{/if}
      </p>
      <ul class="sample">
        {#each fresh.slice(0, 4) as r (r.id)}
          <li><span class="when">{fmtShortDate(r.time)}</span><span class="val tnum">{formatValue(r.mmol, unit)}</span><span class="unit">{unit}</span></li>
        {/each}
        {#if fresh.length > 4}<li class="more">and {fresh.length - 4} more</li>{/if}
      </ul>
    {/if}
    {#snippet footer()}
      {#if fresh.length}
        <button type="button" class="btn" onclick={() => (app.importing = null)}>Cancel</button>
        <button type="button" class="btn primary" data-autofocus onclick={() => app.confirmImport()}>Import {fresh.length} reading{fresh.length === 1 ? '' : 's'}</button>
      {:else}
        <button type="button" class="btn primary" data-autofocus onclick={() => (app.importing = null)}>Done</button>
      {/if}
    {/snippet}
  </Dialog>
{/if}

<style>
  .file {
    font-size: 13px;
    color: var(--ink-3);
    margin-bottom: 8px;
    word-break: break-all;
  }
  .text {
    font-size: 14px;
    color: var(--ink-2);
  }
  .text strong {
    color: var(--ink);
  }
  .sample {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }
  .sample li {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .when {
    width: 64px;
    color: var(--ink-3);
  }
  .val {
    font-weight: 600;
  }
  .unit {
    color: var(--ink-3);
    font-size: 12px;
  }
  .more {
    color: var(--ink-3);
  }
</style>
