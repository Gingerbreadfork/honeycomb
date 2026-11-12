<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatValue } from '../lib/glucose';
  import { fmtShortDate } from '../lib/time';
  import Dialog from './Dialog.svelte';

  const job = $derived(app.importing);
  const fresh = $derived(job ? job.plan.add.filter((r) => !r.deleted) : []);
  const span = $derived.by(() => {
    if (!fresh.length) return '';
    let first = Infinity;
    let last = -Infinity;
    for (const r of fresh) {
      first = Math.min(first, r.time.getTime());
      last = Math.max(last, r.time.getTime());
    }
    const a = new Date(first);
    const b = new Date(last);
    return a.toDateString() === b.toDateString() ? fmtShortDate(a) : `${fmtShortDate(a)} to ${fmtShortDate(b)}`;
  });
  const unit = $derived(app.settings.unit);
  const skipped = $derived(job?.plan.skipped ?? 0);
  const deleted = $derived(job?.plan.deleted.length ?? 0);
  let restore = $state(false);
  const count = $derived(fresh.length + (restore ? deleted : 0));

  let choosing = $state(false);
  const showColumns = $derived(job !== null && job.headers.length > 0 && (choosing || job.plan.total === 0));

  function pick(which: 'time' | 'glucose', e: Event): void {
    choosing = true;
    app.remapImport({ [which]: Number((e.currentTarget as HTMLSelectElement).value) });
  }

  function pickUnit(e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement).value;
    app.remapImport({ unit: v === 'mmol/L' || v === 'mg/dL' ? v : undefined });
  }

  function close(): void {
    choosing = false;
    restore = false;
    app.importing = null;
  }

  function confirm(): void {
    const bringBack = restore;
    choosing = false;
    restore = false;
    app.confirmImport(bringBack);
  }
</script>

{#if job}
  <Dialog title="Import readings" width={440} onclose={close}>
    <p class="file">{job.name}</p>
    {#if job.plan.total === 0}
      <p class="text">
        No readings were found in this file. Honeycomb expects a CSV with a time column and a glucose column.
        {#if skipped}It has {skipped} line{skipped === 1 ? '' : 's'}, but none had a time and a value that could be read.{/if}
      </p>
    {:else if fresh.length === 0}
      <p class="text">
        {#if deleted}
          Nothing in this file is new. {job.plan.total} reading{job.plan.total === 1 ? '' : 's'} checked.
        {:else}
          Everything in this file is already here. {job.plan.total} reading{job.plan.total === 1 ? '' : 's'} checked, nothing new.
        {/if}
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
    {#if deleted}
      <label class="restore">
        <input type="checkbox" bind:checked={restore} />
        <span>Bring back {deleted === 1 ? 'the reading' : `the ${deleted} readings`} in this file that {deleted === 1 ? 'was' : 'were'} deleted here</span>
      </label>
    {/if}
    {#if skipped && job.plan.total > 0}
      <p class="text skipped">{skipped} line{skipped === 1 ? '' : 's'} could not be read and will be left out.</p>
    {/if}
    {#if showColumns}
      <div class="columns">
        <label>
          <span>Time is in</span>
          <select class="field" value={String(job.time)} onchange={(e) => pick('time', e)}>
            {#if job.time < 0}<option value="-1" disabled>Choose a column</option>{/if}
            {#each job.headers as h, i (i)}
              <option value={String(i)}>{h || `Column ${i + 1}`}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Glucose is in</span>
          <select class="field" value={String(job.glucose)} onchange={(e) => pick('glucose', e)}>
            {#if job.glucose < 0}<option value="-1" disabled>Choose a column</option>{/if}
            {#each job.headers as h, i (i)}
              <option value={String(i)}>{h || `Column ${i + 1}`}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Values are in</span>
          <select class="field" value={job.choice.unit ?? 'file'} onchange={pickUnit}>
            <option value="file">Whatever the file says</option>
            <option value="mmol/L">mmol/L</option>
            <option value="mg/dL">mg/dL</option>
          </select>
        </label>
      </div>
    {:else if job.headers.length}
      <button type="button" class="btn small ghost remap" onclick={() => (choosing = true)}>Not right? Choose the columns</button>
    {/if}
    {#snippet footer()}
      {#if count}
        <button type="button" class="btn" onclick={close}>Cancel</button>
        <button type="button" class="btn primary" data-autofocus onclick={confirm}>Import {count} reading{count === 1 ? '' : 's'}</button>
      {:else}
        <button type="button" class="btn primary" data-autofocus onclick={close}>Done</button>
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
  .skipped {
    margin-top: 12px;
  }
  .restore {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-top: 14px;
    font-size: 13px;
    color: var(--ink-2);
    cursor: pointer;
  }
  .restore input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .columns {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .columns label {
    display: grid;
    grid-template-columns: 110px 1fr;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: var(--ink-2);
  }
  .columns select {
    min-width: 0;
  }
  .remap {
    margin-top: 12px;
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
