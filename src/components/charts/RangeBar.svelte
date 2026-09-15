<script lang="ts">
  import type { TirSplit } from '../../lib/stats';

  let { split, counts, thin = false }: { split: TirSplit | null; counts?: TirSplit; thin?: boolean } = $props();

  const pct = (f: number) => Math.round(f * 100);
  const segs = $derived(
    split
      ? [
          { key: 'low', label: 'low', f: split.low, n: counts?.low },
          { key: 'in', label: 'in range', f: split.inRange, n: counts?.inRange },
          { key: 'high', label: 'high', f: split.high, n: counts?.high },
        ]
      : [],
  );
</script>

<div class="range" class:thin>
  <div class="bar" role="img" aria-label={split ? segs.map((s) => `${pct(s.f)}% ${s.label}`).join(', ') : 'No readings'}>
    {#if split}
      {#each segs.filter((s) => s.f > 0) as s (s.key)}
        <div class="seg {s.key}" style:flex-grow={s.f}></div>
      {/each}
    {:else}
      <div class="seg empty"></div>
    {/if}
  </div>
  {#if split}
    <div class="legend">
      {#each segs as s (s.key)}
        <div class="item">
          <span class="dot {s.key}"></span>
          <span class="n tnum">{pct(s.f)}%</span>
          <span class="lbl">{s.label}</span>
          {#if s.n !== undefined}<span class="cnt">({s.n})</span>{/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .range {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar {
    display: flex;
    gap: 2px;
    height: 16px;
    border-radius: 4px;
    overflow: hidden;
  }
  .thin .bar {
    height: 10px;
  }
  .seg {
    flex-basis: 0;
    min-width: 3px;
  }
  .seg.low {
    background: var(--low);
  }
  .seg.in {
    background: var(--in);
    opacity: 0.72;
  }
  .seg.high {
    background: var(--high);
  }
  .seg.empty {
    flex-grow: 1;
    background: var(--card-2);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    font-size: 13px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .n {
    font-weight: 600;
  }
  .lbl,
  .cnt {
    color: var(--ink-2);
  }
</style>
