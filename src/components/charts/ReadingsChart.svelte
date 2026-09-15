<script lang="ts">
  import {
    contextLabel,
    formatValue,
    fromMmol,
    STATUS_LABEL,
    statusOf,
    toMmol,
    toneOf,
    type Reading,
    type Targets,
    type Unit,
  } from '../../lib/glucose';
  import { hexPath, linear, ticks } from '../../lib/scale';
  import { addDays, fmtDateTime, fmtShortDate, fmtWeekday, startOfDay } from '../../lib/time';

  let {
    readings,
    from,
    to,
    targets,
    unit,
    height = 240,
    compact = false,
    interactive = true,
  }: {
    readings: Reading[];
    from: Date;
    to: Date;
    targets: Targets;
    unit: Unit;
    height?: number;
    compact?: boolean;
    interactive?: boolean;
  } = $props();

  let width = $state(640);
  let hover = $state<number | null>(null);

  const m = $derived({ top: 12, right: 14, bottom: compact ? 24 : 28, left: 40 });
  const innerW = $derived(Math.max(10, width - m.left - m.right));
  const innerH = $derived(height - m.top - m.bottom);
  const days = $derived(Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5)));

  const yDomain = $derived.by((): [number, number] => {
    let lo = targets.low - 1.5;
    let hi = targets.high + 2.5;
    for (const r of readings) {
      if (r.mmol < lo) lo = r.mmol;
      if (r.mmol > hi) hi = r.mmol;
    }
    return [Math.max(0, Math.floor(lo - 0.4)), Math.ceil(hi + 0.4)];
  });
  const x = $derived(linear([from.getTime(), to.getTime()], [m.left, m.left + innerW]));
  const y = $derived(linear(yDomain, [m.top + innerH, m.top]));

  const yTicks = $derived.by(() => {
    const [lo, hi] = yDomain;
    return ticks(fromMmol(lo, unit), fromMmol(hi, unit), compact ? 4 : 5)
      .map((v) => ({ v: toMmol(v, unit), label: unit === 'mmol/L' ? String(v) : String(Math.round(v)) }))
      .filter((t) => t.v >= lo && t.v <= hi);
  });

  const xTicks = $derived.by(() => {
    const maxTicks = Math.max(2, Math.floor(innerW / 68));
    const step = Math.max(1, Math.ceil(days / maxTicks));
    const out: { x: number; label: string }[] = [];
    for (let d = startOfDay(from); d < to; d = addDays(d, step)) {
      out.push({ x: x(d.getTime()), label: days <= 14 ? `${fmtWeekday(d)} ${d.getDate()}` : fmtShortDate(d) });
    }
    return out;
  });

  const points = $derived(
    readings.map((r, i) => ({ i, r, px: x(r.time.getTime()), py: y(r.mmol), tone: toneOf(statusOf(r.mmol, targets)) })),
  );

  const paths = $derived.by(() => {
    const out: string[] = [];
    let cur: string[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[i - 1];
      if (prev && p.r.time.getTime() - prev.r.time.getTime() <= 10 * 3600e3) {
        cur.push(`L${p.px.toFixed(1)} ${p.py.toFixed(1)}`);
      } else {
        if (cur.length > 1) out.push(cur.join(' '));
        cur = [`M${p.px.toFixed(1)} ${p.py.toFixed(1)}`];
      }
    }
    if (cur.length > 1) out.push(cur.join(' '));
    return out;
  });

  const hovered = $derived(hover === null ? null : (points[hover] ?? null));
  const tipLeft = $derived(hovered ? hovered.px > width * 0.6 : false);

  function onmove(e: PointerEvent): void {
    if (!interactive || !points.length) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best = -1;
    let bestD = Infinity;
    for (const p of points) {
      const d = (p.px - px) ** 2 + ((p.py - py) / 2) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.i;
      }
    }
    hover = best >= 0 ? best : null;
  }

  function onkey(e: KeyboardEvent): void {
    if (!points.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      hover = hover === null ? (d > 0 ? 0 : points.length - 1) : Math.max(0, Math.min(points.length - 1, hover + d));
    } else if (e.key === 'Escape') hover = null;
  }
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <svg
    {width}
    {height}
    viewBox="0 0 {width} {height}"
    role={interactive ? 'application' : 'img'}
    aria-label="Readings over time"
    tabindex={interactive ? 0 : -1}
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

    {#each paths as d, i (i)}
      <path class="line" {d} />
    {/each}

    {#each points as p (p.r.id)}
      <path class="pt {p.tone}" d={hexPath(p.px, p.py, hover === p.i ? 7 : 5)} />
    {/each}

    {#if !readings.length}
      <text class="empty" x={m.left + innerW / 2} y={m.top + innerH / 2} text-anchor="middle" dominant-baseline="middle">
        No readings in this period
      </text>
    {/if}
  </svg>

  {#if hovered && interactive}
    <div class="tip" class:left={tipLeft} style:left="{hovered.px}px" style:top="{hovered.py}px">
      <div class="tip-value">{formatValue(hovered.r.mmol, unit)} <span>{unit}</span></div>
      <div class="tip-row"><span class="dot {hovered.tone}"></span>{STATUS_LABEL[statusOf(hovered.r.mmol, targets)]}</div>
      <div class="tip-muted">{fmtDateTime(hovered.r.time)}</div>
      {#if hovered.r.context || hovered.r.note}
        <div class="tip-muted">
          {#if hovered.r.context}{contextLabel(hovered.r.context)}{/if}
          {#if hovered.r.context && hovered.r.note}, {/if}
          {hovered.r.note}
        </div>
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
    stroke: var(--ink-4);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
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
