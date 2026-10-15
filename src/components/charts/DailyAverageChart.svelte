<script lang="ts">
  import { formatValue, fromMmol, STATUS_LABEL, statusOf, toMmol, toneOf, type Targets, type Unit } from '../../lib/glucose';
  import { hexPath, linear, ticks } from '../../lib/scale';
  import type { DayAverage } from '../../lib/stats';
  import { addDays, fmtShortDate, fmtWeekday, startOfDay } from '../../lib/time';

  let {
    days,
    from,
    to,
    targets,
    unit,
    height = 240,
  }: { days: DayAverage[]; from: Date; to: Date; targets: Targets; unit: Unit; height?: number } = $props();

  let width = $state(640);
  let hover = $state<number | null>(null);

  const m = { top: 12, right: 14, bottom: 28, left: 40 };
  const innerW = $derived(Math.max(10, width - m.left - m.right));
  const innerH = $derived(height - m.top - m.bottom);
  const spanDays = $derived(Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5)));
  const slot = $derived(innerW / spanDays);
  const showMarkers = $derived(slot >= 14);

  const yDomain = $derived.by((): [number, number] => {
    let lo = targets.low - 1.5;
    let hi = targets.high + 2.5;
    for (const d of days) {
      if (d.mean === null) continue;
      if (d.mean < lo) lo = d.mean;
      if (d.mean > hi) hi = d.mean;
    }
    return [Math.max(0, Math.floor(lo - 0.4)), Math.ceil(hi + 0.4)];
  });
  const x = $derived(linear([from.getTime(), to.getTime()], [m.left, m.left + innerW]));
  const y = $derived(linear(yDomain, [m.top + innerH, m.top]));

  const yTicks = $derived.by(() => {
    const [lo, hi] = yDomain;
    return ticks(fromMmol(lo, unit), fromMmol(hi, unit), 5)
      .map((v) => ({ v: toMmol(v, unit), label: unit === 'mmol/L' ? String(v) : String(Math.round(v)) }))
      .filter((t) => t.v >= lo && t.v <= hi);
  });

  const xTicks = $derived.by(() => {
    const maxTicks = Math.max(2, Math.floor(innerW / 68));
    const step = Math.max(1, Math.ceil(spanDays / maxTicks));
    const out: { x: number; label: string }[] = [];
    for (let d = startOfDay(from); d < to; d = addDays(d, step)) {
      out.push({ x: x(d.getTime()), label: spanDays <= 14 ? `${fmtWeekday(d)} ${d.getDate()}` : fmtShortDate(d) });
    }
    return out;
  });

  const points = $derived(
    days.map((d, i) => ({
      i,
      d,
      px: x(d.start.getTime() + 432e5),
      py: d.mean === null ? m.top : y(d.mean),
      tone: d.mean === null ? null : toneOf(statusOf(d.mean, targets)),
    })),
  );
  const withData = $derived(points.filter((p) => p.d.mean !== null));

  const paths = $derived.by(() => {
    let solid = '';
    let bridged = '';
    let prev: (typeof points)[number] | null = null;
    for (const p of withData) {
      const at = `${p.px.toFixed(1)} ${p.py.toFixed(1)}`;
      if (prev && p.i - prev.i === 1) solid += ` L${at}`;
      else {
        solid += ` M${at}`;
        if (prev) bridged += ` M${prev.px.toFixed(1)} ${prev.py.toFixed(1)} L${at}`;
      }
      prev = p;
    }
    return { solid, bridged };
  });

  const hovered = $derived(hover === null ? null : (points[hover] ?? null));
  const tipLeft = $derived(hovered ? hovered.px > width * 0.6 : false);

  function onmove(e: PointerEvent): void {
    if (!withData.length) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    hover = Math.max(0, Math.min(points.length - 1, Math.floor((px - m.left) / slot)));
  }

  function onkey(e: KeyboardEvent): void {
    if (!withData.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const right = e.key === 'ArrowRight';
      const at = hover;
      let next: (typeof points)[number] | undefined;
      if (at === null) next = right ? withData[0] : withData[withData.length - 1];
      else if (right) next = withData.find((p) => p.i > at);
      else for (const p of withData) if (p.i < at) next = p;
      if (next) hover = next.i;
    } else if (e.key === 'Escape') hover = null;
  }

  function spread(d: DayAverage): string {
    if (d.min === null || d.max === null) return '';
    return d.count === 1 ? '' : `${formatValue(d.min, unit)} to ${formatValue(d.max, unit)}`;
  }
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <svg
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role="application"
    aria-label="Daily average over time"
    tabindex="0"
    onpointermove={onmove}
    onpointerleave={() => (hover = null)}
    onkeydown={onkey}
    onblur={() => (hover = null)}
  >
    <rect class="band" x={m.left} width={innerW} y={y(targets.high)} height={Math.max(0, y(targets.low) - y(targets.high))} />
    <line class="band-edge" x1={m.left} x2={m.left + innerW} y1={y(targets.high)} y2={y(targets.high)} />
    <line class="band-edge" x1={m.left} x2={m.left + innerW} y1={y(targets.low)} y2={y(targets.low)} />
    {#each yTicks as t (t.v)}
      <line class="grid" x1={m.left} x2={m.left + innerW} y1={y(t.v)} y2={y(t.v)} />
      <text class="tick tnum" x={m.left - 8} y={y(t.v)} text-anchor="end" dominant-baseline="middle">{t.label}</text>
    {/each}
    {#each xTicks as t (t.x)}
      <text class="tick" x={t.x} y={height - 6} text-anchor="start">{t.label}</text>
    {/each}

    {#if hovered}
      <line class="cross" x1={hovered.px} x2={hovered.px} y1={m.top} y2={m.top + innerH} />
    {/if}

    {#if paths.bridged}
      <path class="line bridged" d={paths.bridged} />
    {/if}
    <path class="line" d={paths.solid} />

    {#each withData as p (p.d.start.getTime())}
      {#if showMarkers || hover === p.i}
        <path class="pt {p.tone}" d={hexPath(p.px, p.py, hover === p.i ? 7 : 5)} />
      {/if}
    {/each}

    {#if !withData.length}
      <text class="empty" x={m.left + innerW / 2} y={m.top + innerH / 2} text-anchor="middle" dominant-baseline="middle">
        No readings in this period
      </text>
    {/if}
  </svg>

  {#if hovered}
    <div class="tip" class:left={tipLeft} style:left="{hovered.px}px" style:top="{hovered.py}px">
      <div class="tip-title">{fmtWeekday(hovered.d.start)} {fmtShortDate(hovered.d.start)}</div>
      {#if hovered.d.mean !== null && hovered.tone}
        <div class="tip-value">{formatValue(hovered.d.mean, unit)} <span>{unit}</span></div>
        <div class="tip-row"><span class="dot {hovered.tone}"></span>{STATUS_LABEL[statusOf(hovered.d.mean, targets)]}</div>
        <div class="tip-muted">
          {hovered.d.count} reading{hovered.d.count === 1 ? '' : 's'}{#if spread(hovered.d)}, {spread(hovered.d)}{/if}
        </div>
      {:else}
        <div class="tip-muted">No readings</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chart {
    position: relative;
    width: 100%;
  }
  svg {
    display: block;
    overflow: visible;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 4px;
    border-radius: 4px;
  }
  .band {
    fill: var(--band-fill);
  }
  .band-edge {
    stroke: var(--band-edge);
    stroke-width: 1;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick {
    fill: var(--ink-3);
    font-size: 11.5px;
  }
  .cross {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .line {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .line.bridged {
    stroke: var(--ink-3);
    stroke-width: 1.5;
    stroke-dasharray: 2 5;
  }
  .pt {
    stroke: var(--paper);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .pt.in {
    fill: var(--in);
  }
  .pt.low {
    fill: var(--low);
  }
  .pt.high {
    fill: var(--high);
  }
  .pt.very-high {
    fill: var(--very-high);
  }
  .empty {
    fill: var(--ink-3);
    font-size: 13px;
  }
  .tip {
    position: absolute;
    z-index: 5;
    transform: translate(14px, -50%);
    min-width: 150px;
    padding: 9px 12px 10px;
    background: var(--popover);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    font-size: 12.5px;
    line-height: 1.4;
    animation: fade-in var(--t-fast) var(--ease-out);
  }
  .tip.left {
    transform: translate(calc(-100% - 14px), -50%);
  }
  .tip-title {
    color: var(--ink-2);
  }
  .tip-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--ink);
  }
  .tip-value span {
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-2);
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    color: var(--ink);
  }
  .tip-muted {
    color: var(--ink-2);
  }
</style>
