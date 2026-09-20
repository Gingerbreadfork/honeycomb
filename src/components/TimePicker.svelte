<script lang="ts">
  import { dateInputValue, fmtDateTime, fromInputs, timeInputValue } from '../lib/time';
  import Icon from './Icon.svelte';

  let { value, pinned, onchange }: { value: Date; pinned: boolean; onchange: (d: Date | null) => void } = $props();

  let open = $state(false);
  let date = $state('');
  let time = $state('');
  let root: HTMLDivElement;

  const quick = [
    { label: 'Now', min: 0 },
    { label: '15 min ago', min: 15 },
    { label: '30 min ago', min: 30 },
    { label: '1 hour ago', min: 60 },
    { label: '2 hours ago', min: 120 },
  ];

  function toggle(): void {
    if (!open) {
      date = dateInputValue(value);
      time = timeInputValue(value);
    }
    open = !open;
  }

  function pick(min: number): void {
    onchange(min === 0 ? null : new Date(Date.now() - min * 60_000));
    open = false;
  }

  function apply(): void {
    const d = fromInputs(date, time);
    if (d) onchange(d);
    open = false;
  }

  function onDocPointer(e: PointerEvent): void {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }

  function onkeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      open = false;
      root.querySelector<HTMLElement>('.chip')?.focus();
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.stopPropagation();
      apply();
    }
  }

  function focusPop(node: HTMLElement): void {
    node.querySelector<HTMLElement>('button')?.focus();
  }
</script>

<svelte:document onpointerdown={onDocPointer} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker" bind:this={root} onkeydown={onkeydown}>
  <button type="button" class="chip" class:pinned aria-expanded={open} onclick={toggle}>
    <Icon name="clock" size={14} />
    <span class="when">{fmtDateTime(value)}</span>
    <span class="change">{pinned ? 'Edit' : 'Change'}</span>
  </button>
  {#if pinned}
    <button type="button" class="reset" onclick={() => onchange(null)}>Use now</button>
  {/if}

  {#if open}
    <div class="pop" role="dialog" tabindex="-1" aria-label="Time of reading" {@attach focusPop}>
      <div class="quick">
        {#each quick as q (q.min)}
          <button type="button" onclick={() => pick(q.min)}>{q.label}</button>
        {/each}
      </div>
      <div class="manual">
        <label>
          <span>Date</span>
          <input class="field" type="date" bind:value={date} />
        </label>
        <label>
          <span>Time</span>
          <input class="field" type="time" bind:value={time} />
        </label>
      </div>
      <div class="actions">
        <button type="button" class="btn small ghost" onclick={() => (open = false)}>Cancel</button>
        <button type="button" class="btn small primary" onclick={apply}>Set time</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 10px 0 11px;
    border-radius: var(--radius-sm);
    background: var(--card-2);
    color: var(--ink);
    transition: background var(--t-fast) var(--ease-out);
  }
  .chip:hover {
    background: var(--card-3);
  }
  .chip.pinned {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .chip :global(svg) {
    color: var(--ink-2);
  }
  .when {
    font-variant-numeric: tabular-nums;
  }
  .change {
    color: var(--ink-3);
    font-size: 12.5px;
    margin-left: 2px;
  }
  .chip.pinned .change {
    color: var(--ink-2);
  }
  .reset {
    color: var(--ink-2);
    font-size: 13px;
    padding: 4px 6px;
  }
  .reset:hover {
    color: var(--ink);
    background: var(--card-2);
  }
  .pop {
    position: absolute;
    left: 0;
    top: calc(100% + 8px);
    z-index: 30;
    width: 300px;
    padding: 12px;
    background: var(--popover);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    animation: pop-in var(--t-med) var(--ease-spring);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .quick button {
    height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--card-2);
    color: var(--ink);
    font-size: 13px;
  }
  .quick button:hover {
    background: var(--card-3);
  }
  .manual {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }
  .manual label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12.5px;
    color: var(--ink-2);
  }
  .manual input {
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }
</style>
