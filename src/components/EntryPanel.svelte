<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { CONTEXTS, formatValue, inputHint, parseInput, STATUS_LABEL, statusOf, toneOf, type Context } from '../lib/glucose';
  import { fmtDateTime } from '../lib/time';
  import TimePicker from './TimePicker.svelte';
  import Icon from './Icon.svelte';
  import { isMobile } from '../lib/platform';

  let text = $state('');
  let context = $state<Context>('');
  let note = $state('');
  let pinnedTime = $state<Date | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let noteEl = $state<HTMLTextAreaElement | null>(null);
  let mirrorWidth = $state(0);
  let saved = $state(false);
  let shake = $state(false);

  const unit = $derived(app.settings.unit);
  const mmol = $derived(parseInput(text, unit));
  const hint = $derived(inputHint(text, unit));
  const status = $derived(mmol === null ? null : statusOf(mmol, app.settings.targets));
  const time = $derived(pinnedTime ?? app.now);
  const placeholder = $derived(unit === 'mmol/L' ? '0.0' : '0');
  const last = $derived(app.readings.length ? app.readings[app.readings.length - 1] : null);
  const lastStatus = $derived(last ? statusOf(last.mmol, app.settings.targets) : null);

  function save(): void {
    if (mmol === null) {
      shake = true;
      setTimeout(() => (shake = false), 420);
      input?.focus();
      return;
    }
    app.add({ time: pinnedTime ?? new Date(), mmol, context, note: note.trim() });
    saved = true;
    setTimeout(() => (saved = false), 1300);
    text = '';
    context = '';
    note = '';
    pinnedTime = null;
    if (noteEl) noteEl.style.height = 'auto';
    input?.focus();
  }

  function onInput(e: Event): void {
    text = (e.currentTarget as HTMLInputElement).value.replace(/[^\d.,]/g, '').slice(0, 5);
  }

  function onValueKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      text = '';
    }
  }

  function onNoteKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  }

  function autogrow(node: HTMLTextAreaElement): () => void {
    const fit = () => {
      node.style.height = 'auto';
      node.style.height = `${node.scrollHeight}px`;
    };
    node.addEventListener('input', fit);
    return () => node.removeEventListener('input', fit);
  }

  function focusOnMount(node: HTMLInputElement): void {
    node.focus();
  }
</script>

<form
  class="entry"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <h2 class="display">New reading</h2>

  <div class="hero" class:shake>
    <div class="value">
      <span class="mirror" aria-hidden="true" bind:clientWidth={mirrorWidth}>{text || placeholder}</span>
      <input
        bind:this={input}
        value={text}
        oninput={onInput}
        onkeydown={onValueKey}
        inputmode="decimal"
        enterkeyhint="done"
        autocomplete="off"
        spellcheck="false"
        {placeholder}
        aria-label="Blood glucose reading in {unit}"
        style:width="{Math.max(mirrorWidth, 36) + 6}px"
        {@attach focusOnMount}
      />
      <span class="unit">{unit}</span>
    </div>
    <div class="status" aria-live="polite">
      {#if status}
        <span class="dot {toneOf(status)}"></span>
        <span>{STATUS_LABEL[status]}</span>
      {:else if hint}
        <span class="hint">{hint}</span>
      {:else}
        <span class="hint quiet">{isMobile ? 'Type a reading, then tap Done' : 'Type a reading, press Enter'}</span>
      {/if}
    </div>
  </div>

  <div class="row">
    <TimePicker value={time} pinned={pinnedTime !== null} onchange={(d) => (pinnedTime = d)} />
  </div>

  <div class="chips" role="group" aria-label="Context">
    {#each CONTEXTS as c (c.value)}
      <button type="button" class="chip" aria-pressed={context === c.value} onclick={() => (context = context === c.value ? '' : c.value)}>
        {c.label}
      </button>
    {/each}
  </div>

  <textarea
    class="note"
    rows="1"
    placeholder="Add a note"
    bind:this={noteEl}
    bind:value={note}
    onkeydown={onNoteKey}
    {@attach autogrow}
  ></textarea>

  <button type="submit" class="btn primary save" class:saved>
    {#if saved}
      <Icon name="check" />
      <span>Saved</span>
    {:else}
      <span>Save reading</span>
      {#if !isMobile}<kbd>Enter</kbd>{/if}
    {/if}
  </button>

  {#if last && lastStatus}
    <div class="last">
      <div class="last-label">Last reading</div>
      <div class="last-row">
        <span class="last-val">{formatValue(last.mmol, unit)}</span>
        <span class="last-meta">
          <span class="dot {toneOf(lastStatus)}"></span>
          <span>{STATUS_LABEL[lastStatus]}, {fmtDateTime(last.time, app.now)}</span>
        </span>
      </div>
    </div>
  {/if}
</form>

<style>
  .entry {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 22px 26px 26px;
    height: 100%;
  }
  h2 {
    font-size: 20px;
    color: var(--ink-2);
  }
  .hero {
    padding: 6px 0 2px;
  }
  .hero.shake {
    animation: shake 0.4s var(--ease-out);
  }
  .value {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-height: 92px;
  }
  .mirror,
  input {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 88px;
    line-height: 1;
    letter-spacing: -0.035em;
    font-variant-numeric: lining-nums proportional-nums;
  }
  .mirror {
    position: absolute;
    visibility: hidden;
    white-space: pre;
    pointer-events: none;
  }
  input {
    background: none;
    border: 0;
    padding: 0;
    color: var(--ink);
    caret-color: var(--accent);
    min-width: 36px;
    max-width: 100%;
    border-bottom: 2px solid var(--line-strong);
    transition: border-color var(--t-med) var(--ease-out);
  }
  input::placeholder {
    color: var(--line-strong);
  }
  input:focus-visible {
    outline: none;
  }
  input:focus {
    border-color: var(--accent);
  }
  .unit {
    font-size: 15px;
    color: var(--ink-2);
    padding-bottom: 14px;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    margin-top: 10px;
    font-size: 14px;
    font-weight: 500;
  }
  .hint {
    color: var(--ink-2);
    font-weight: 400;
  }
  .hint.quiet {
    color: var(--ink-3);
  }
  .row {
    display: flex;
    align-items: center;
  }
  .chips {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .chip {
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--card-2);
    color: var(--ink-2);
    font-size: 13.5px;
    font-weight: 500;
    transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
  }
  .chip:hover {
    background: var(--card-3);
    color: var(--ink);
  }
  .chip[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .note {
    width: 100%;
    border: 0;
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    background: var(--card-2);
    color: var(--ink);
    line-height: 1.4;
    max-height: 120px;
    overflow: auto;
    transition: background var(--t-fast) var(--ease-out), box-shadow var(--t-fast) var(--ease-out);
  }
  .note::placeholder {
    color: var(--ink-3);
  }
  .note:focus {
    background: var(--card);
    box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px var(--accent-soft);
  }
  .save {
    margin-top: 4px;
    height: 42px;
    font-size: 15px;
    justify-content: space-between;
    padding: 0 12px 0 16px;
    transition: background var(--t-med) var(--ease-out), transform var(--t-fast) var(--ease-out);
  }
  .save.saved {
    justify-content: center;
    gap: 8px;
  }
  kbd {
    font: inherit;
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 5px;
    background: oklch(0% 0 0 / 0.14);
    color: var(--accent-ink);
    opacity: 0.85;
  }
  .last {
    margin-top: auto;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
  .last-label {
    font-size: 12.5px;
    color: var(--ink-3);
  }
  .last-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-top: 2px;
  }
  .last-val {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 30px;
    line-height: 1.1;
    letter-spacing: -0.025em;
  }
  .last-meta {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--ink-2);
  }
  :global(.app.mobile) .entry {
    padding: 14px 16px 18px;
    gap: 14px;
    height: auto;
  }
  :global(.app.mobile) h2 {
    font-size: 17px;
  }
  :global(.app.mobile) .mirror,
  :global(.app.mobile) input {
    font-size: 64px;
  }
  :global(.app.mobile) .value {
    min-height: 68px;
  }
  :global(.app.mobile) .unit {
    padding-bottom: 10px;
  }
  :global(.app.mobile) .status {
    margin-top: 6px;
  }
  :global(.app.mobile) .chip {
    height: 38px;
    font-size: 14.5px;
  }
  :global(.app.mobile) .save {
    height: 46px;
  }
  :global(.app.mobile) .last {
    display: none;
  }
  @keyframes shake {
    10%,
    90% {
      transform: translateX(-1px);
    }
    20%,
    80% {
      transform: translateX(2px);
    }
    30%,
    50%,
    70% {
      transform: translateX(-4px);
    }
    40%,
    60% {
      transform: translateX(4px);
    }
  }
</style>
