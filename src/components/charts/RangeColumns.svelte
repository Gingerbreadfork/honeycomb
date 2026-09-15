<script lang="ts">
  import type { Bucket } from '../../lib/stats';
  import { fmtShortDate, fmtWeekday } from '../../lib/time';

  let { buckets, byWeek, height = 96 }: { buckets: Bucket[]; byWeek: boolean; height?: number } = $props();

  let width = $state(640);
  let hover = $state<number | null>(null);

  const m = { top: 6, bottom: 22 };
  const innerH = $derived(height - m.top - m.bottom);
  const slot = $derived(buckets.length ? width / buckets.length : width);
  const colW = $derived(Math.max(3, Math.min(16, slot - 4)));
  const labelEvery = $derived(Math.max(1, Math.ceil(64 / slot)));

  function segs(b: Bucket): { key: string; y: number; h: number }[] {
    if (!b.total) return [];
    const gap = 2;
    const order = [
      ['low', b.counts.low],
      ['in', b.counts.inRange],
      ['high', b.counts.high],
    ].filter(([, n]) => (n as number) > 0) as [string, number][];
    const usable = innerH - gap * (order.length - 1);
    let yCursor = m.top + innerH;
    return order.map(([key, n]) => {
      const h = (n / b.total) * usable;
      yCursor -= h;
      const y = yCursor;
      yCursor -= gap;
      return { key, y, h };
    });
  }

  function label(b: Bucket): string {
    return byWeek ? fmtShortDate(b.start) : `${fmtWeekday(b.start)} ${b.start.getDate()}`;
  }
  const hovered = $derived(hover === null ? null : (buckets[hover] ?? null));
</script>

<div class="cols" bind:clientWidth={width} style:height="{height}px">
  <svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label="Time in range by {byWeek ? 'week' : 'day'}">
    {#each buckets as b, i (b.start.getTime())}
      {@const cx = slot * i + slot / 2}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        class="hit"
        x={slot * i}
        y={0}
        width={slot}
        {height}
        onpointerenter={() => (hover = i)}
        onpointerleave={() => (hover = null)}
      />
      {#if b.total}
        {#each segs(b) as s (s.key)}
          <rect class="seg {s.key}" x={cx - colW / 2} y={s.y} width={colW} height={Math.max(1, s.h)} rx={Math.min(3, colW / 2)} />
        {/each}
      {:else}
        <rect class="none" x={cx - colW / 2} y={m.top + innerH - 2} width={colW} height={2} rx={1} />
      {/if}
      {#if i % labelEvery === 0}
        <text class="tick" x={cx} y={height - 6} text-anchor="middle">{label(b)}</text>
      {/if}
    {/each}
  </svg>
  {#if hovered}
    {@const i = hover ?? 0}
    <div class="tip" class:left={slot * i > width * 0.6} style:left="{slot * i + slot / 2}px" style:top="{m.top}px">
      <div class="tip-title">{byWeek ? `Week of ${fmtShortDate(hovered.start)}` : `${fmtWeekday(hovered.start)} ${fmtShortDate(hovered.start)}`}</div>
      {#if hovered.total}
        <div class="tip-muted">{hovered.total} reading{hovered.total === 1 ? '' : 's'}</div>
        <div class="tip-row"><span class="dot in"></span>{hovered.counts.inRange} in range</div>
        {#if hovered.counts.low}<div class="tip-row"><span class="dot low"></span>{hovered.counts.low} low</div>{/if}
        {#if hovered.counts.high}<div class="tip-row"><span class="dot high"></span>{hovered.counts.high} high</div>{/if}
      {:else}
        <div class="tip-muted">No readings</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .cols {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  .hit {
    fill: transparent;
  }
  .seg.low {
    fill: var(--low);
  }
  .seg.in {
    fill: var(--in);
    opacity: 0.72;
  }
  .seg.high {
    fill: var(--high);
  }
  .none {
    fill: var(--line-strong);
  }
  .tick {
    fill: var(--ink-3);
    font-size: 11px;
  }
  .tip {
    position: absolute;
    z-index: 5;
    transform: translate(14px, 0);
    min-width: 130px;
    padding: 8px 12px 9px;
    background: var(--popover);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    font-size: 12.5px;
    line-height: 1.45;
    animation: fade-in var(--t-fast) var(--ease-out);
  }
  .tip.left {
    transform: translate(calc(-100% - 14px), 0);
  }
  .tip-title {
    font-weight: 600;
  }
  .tip-muted {
    color: var(--ink-2);
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
