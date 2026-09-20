<script lang="ts">
  import { CONTEXTS, MEALS, mealContext, mealOf, timingOf, type Context } from '../lib/glucose';

  let { value = $bindable('') }: { value: Context } = $props();

  const timing = $derived(timingOf(value));
  const meal = $derived(mealOf(value));

  function pressed(chip: Context): boolean {
    return timing ? timingOf(chip) === timing : value === chip;
  }

  function toggle(chip: Context): void {
    value = pressed(chip) ? '' : chip;
  }
</script>

<div class="picker">
  <div class="chips" role="group" aria-label="Context">
    {#each CONTEXTS as c (c.value)}
      <button type="button" class="chip" aria-pressed={pressed(c.value)} onclick={() => toggle(c.value)}>{c.label}</button>
    {/each}
  </div>
  {#if timing}
    <div class="meals" role="group" aria-label="Which meal">
      {#each MEALS as m (m)}
        <button type="button" class="chip small" aria-pressed={meal === m} onclick={() => (value = mealContext(timing, meal === m ? null : m))}>
          {m[0].toUpperCase() + m.slice(1)}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .meals {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    animation: rise-in var(--t-med) var(--ease-out);
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
  .chip.small {
    height: 28px;
    font-size: 13px;
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
  :global(.app.mobile) .chip {
    height: 38px;
    font-size: 14.5px;
  }
  :global(.app.mobile) .chip.small {
    height: 34px;
    font-size: 14px;
  }
</style>
