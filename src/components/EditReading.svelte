<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatValue, inputHint, parseInput, STATUS_LABEL, statusOf, toneOf, type Context, type Reading } from '../lib/glucose';
  import { dateInputValue, fromInputs, instantMs, isFuture, timeInputValue } from '../lib/time';
  import Dialog from './Dialog.svelte';
  import ContextPicker from './ContextPicker.svelte';
  import Icon from './Icon.svelte';

  let { reading, onclose }: { reading: Reading; onclose: () => void } = $props();

  const unit = app.settings.unit;
  // svelte-ignore state_referenced_locally
  const shown = { text: formatValue(reading.mmol, unit), date: dateInputValue(reading.time), time: timeInputValue(reading.time) };
  let text = $state(shown.text);
  let date = $state(shown.date);
  let time = $state(shown.time);
  // svelte-ignore state_referenced_locally
  let context = $state<Context>(reading.context);
  // svelte-ignore state_referenced_locally
  let note = $state(reading.note);

  const mmol = $derived(parseInput(text, unit));
  const hint = $derived(inputHint(text, unit));
  const when = $derived(fromInputs(date, time));
  const future = $derived(when !== null && isFuture(new Date(instantMs(when, reading.offset)), app.now));
  const status = $derived(mmol === null ? null : statusOf(mmol, app.settings.targets));
  const valid = $derived(mmol !== null && when !== null && !future);

  function save(): void {
    if (mmol === null || !when || future) return;
    // Untouched fields keep their stored value rather than the rounded one on screen.
    const value = text.trim() === shown.text ? {} : { mmol, unit };
    const at = date === shown.date && time === shown.time ? {} : { time: when };
    app.update(reading.id, { ...value, ...at, context, note: note.trim() });
    onclose();
    app.toast('Reading updated');
  }

  function remove(): void {
    onclose();
    app.remove(reading.id);
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
      e.preventDefault();
      save();
    }
  }
</script>

<Dialog title="Edit reading" width={440} {onclose}>
  <div class="form" onkeydown={onkeydown} role="presentation">
    <label class="glucose">
      <span class="lbl">Glucose</span>
      <span class="value-wrap">
        <input class="field big tnum" data-autofocus inputmode="decimal" bind:value={text} aria-label="Glucose in {unit}" />
        <span class="unit">{unit}</span>
        {#if status}
          <span class="status"><span class="dot {toneOf(status)}"></span>{STATUS_LABEL[status]}</span>
        {:else if hint}
          <span class="status muted">{hint}</span>
        {/if}
      </span>
    </label>

    <div class="when">
      <label>
        <span class="lbl">Date</span>
        <input class="field tnum" type="date" bind:value={date} />
      </label>
      <label>
        <span class="lbl">Time</span>
        <input class="field tnum" type="time" bind:value={time} />
      </label>
      {#if future}
        <p class="future">That time hasn't happened yet.</p>
      {/if}
    </div>

    <div class="ctx">
      <span class="lbl">Context</span>
      <ContextPicker bind:value={context} />
    </div>

    <label>
      <span class="lbl">Note</span>
      <textarea class="field" rows="2" bind:value={note} placeholder="Optional"></textarea>
    </label>
  </div>

  {#snippet footer()}
    <button type="button" class="btn ghost delete" onclick={remove}><Icon name="trash" size={14} /> Delete</button>
    <span class="spacer"></span>
    <button type="button" class="btn" onclick={onclose}>Cancel</button>
    <button type="button" class="btn primary" onclick={save} disabled={!valid}>Save changes</button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lbl {
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .value-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .big {
    width: 110px;
    height: 44px;
    font-size: 22px;
    font-weight: 600;
    padding: 0 12px;
  }
  .unit {
    color: var(--ink-2);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-left: auto;
    font-size: 13px;
  }
  .when {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .future {
    grid-column: 1 / -1;
    font-size: 13px;
    color: var(--danger-text);
  }
  .ctx {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .delete {
    color: var(--danger-text);
  }
  .spacer {
    flex: 1;
  }
</style>
