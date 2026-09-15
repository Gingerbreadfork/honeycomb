<script lang="ts">
  import type { RangeState, Resolved } from '../lib/range.svelte';
  import { isMobile } from '../lib/platform';
  import Icon from './Icon.svelte';

  let { range, resolved, presets = [7, 14, 30, 90] }: { range: RangeState; resolved: Resolved; presets?: number[] } = $props();
</script>

<div class="picker">
  <button type="button" class="step" aria-label="Previous period" title="Previous period" disabled={!resolved.canBack} onclick={() => range.back()}>
    <Icon name="chevron-left" size={15} />
  </button>
  <div class="seg" role="group" aria-label="Period">
    {#each presets as d (d)}
      <button type="button" aria-pressed={!range.custom && range.days === d} onclick={() => range.setPreset(d)}>
        {isMobile ? `${d}d` : `${d} days`}
      </button>
    {/each}
    <button type="button" aria-pressed={!range.custom && range.days === 0} onclick={() => range.setPreset(0)}>All</button>
    <button type="button" aria-pressed={range.custom} onclick={() => range.setCustom(resolved.from, new Date(resolved.to.getTime() - 1))}>Custom</button>
  </div>
  <button type="button" class="step" aria-label="Next period" title="Next period" disabled={!resolved.canForward} onclick={() => range.forward()}>
    <Icon name="chevron-right" size={15} />
  </button>
  {#if range.custom}
    <div class="dates">
      <input class="field tnum" type="date" bind:value={range.fromText} aria-label="From" />
      <span>to</span>
      <input class="field tnum" type="date" bind:value={range.toText} aria-label="To" />
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 34px;
    border-radius: var(--radius-sm);
    color: var(--ink-2);
    transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  .step:hover:not(:disabled) {
    background: var(--card-2);
    color: var(--ink);
  }
  .step:disabled {
    opacity: 0.3;
  }
  .dates {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--ink-2);
  }
  :global(.app.mobile) .step {
    width: 36px;
    height: 36px;
  }
</style>
