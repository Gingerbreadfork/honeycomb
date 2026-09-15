<script lang="ts">
  import { formatValue, fromMmol, STATUS_LABEL, statusOf, toMmol, toneOf, type Reading, type Targets, type Unit } from '../../lib/glucose';
  import { hexPath, linear, smoothPath, ticks } from '../../lib/scale';
  import { median } from '../../lib/stats';
  import { fmtDateTime, fmtHourTick, hourOfDay } from '../../lib/time';

  let {
    readings,
    targets,
    unit,
    height = 240,
  }: { readings: Reading[]; targets: Targets; unit: Unit; height?: number } = $props();

  let width = $state(640);
  let hover = $state<number | null>(null);

  const m = { top: 12, right: 14, bottom: 28, left: 40 };
  const innerW = $derived(Math.max(10, width - m.left - m.right));
  const innerH = $derived(height - m.top - m.bottom);

  const yDomain = $derived.by((): [number, number] => {
    let lo = targets.low - 1.5;
    let hi = targets.high + 2.5;
    for (const r of readings) {
      if (r.mmol < lo) lo = r.mmol;
      if (r.mmol > hi) hi = r.mmol;
    }
    return [Math.max(0, Math.floor(lo - 0.4)), Math.ceil(hi + 0.4)];
  });
  const x = $derived(linear([0, 24], [m.left, m.left + innerW]));
  const y = $derived(linear(yDomain, [m.top + innerH, m.top]));

  const yTicks = $derived.by(() => {
    const [lo, hi] = yDomain;
    return ticks(fromMmol(lo, unit), fromMmol(hi, unit), 5)
      .map((v) => ({ v: toMmol(v, unit), label: unit === 'mmol/L' ? String(v) : String(Math.round(v)) }))
      .filter((t) => t.v >= lo && t.v <= hi);
  });
  const xTicks = $derived(innerW > 420 ? [0, 3, 6, 9, 12, 15, 18, 21, 24] : [0, 6, 12, 18, 24]);

  const points = $derived(
    readings.map((r, i) => ({ i, r, px: x(hourOfDay(r.time)), py: y(r.mmol), tone: toneOf(statusOf(r.mmol, targets)) })),
  );

  const medianPath = $derived.by(() => {
    if (readings.length < 8) return '';
    const bins: number[][] = Array.from({ length: 12 }, () => []);
    for (const r of readings) bins[Math.min(11, Math.floor(hourOfDay(r.time) / 2))].push(r.mmol);
    const pts: { x: number; y: number }[] = [];
    bins.forEach((b, i) => {
      const med = median(b);
      if (b.length >= 2 && med !== null) pts.push({ x: x(i * 2 + 1), y: y(med) });
    });
    return pts.length >= 3 ? smoothPath(pts, 0.25) : '';
  });

  const hovered = $derived(hover === null ? null : (points[hover] ?? null));
  const tipLeft = $derived(hovered ? hovered.px > width * 0.6 : false);

  function onmove(e: PointerEvent): void {
    if (!points.length) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    let best = -1;
    let bestD = Infinity;
    for (const p of points) {
      const d = (p.px - px) ** 2 + (p.py - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = p.i;
      }
    }
    hover = best >= 0 ? best : null;
  }
</script>

<div class="chart" bind:clientWidth={width} style:height="{height}px">
  <svg {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label="Readings by time of day" onpointermove={onmove} onpointerleave={() => (hover = null)}>
    <rect class="band" x={m.left} width={innerW} y={y(targets.high)} height={Math.max(0, y(targets.low) - y(targets.high))} />
    <line class="band-edge" x1={m.left} x2={m.left + innerW} y1={y(targets.high)} y2={y(targets.high)} />
    <line class="band-edge" x1={m.left} x2={m.left + innerW} y1={y(targets.low)} y2={y(targets.low)} />
    {#each yTicks as t (t.v)}
      <line class="grid" x1={m.left} x2={m.left + innerW} y1={y(t.v)} y2={y(t.v)} />
      <text class="tick tnum" x={m.left - 8} y={y(t.v)} text-anchor="end" dominant-baseline="middle">{t.label}</text>
    {/each}
    {#each xTicks as h (h)}
      <text class="tick" x={x(h)} y={height - 6} text-anchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>{fmtHourTick(h)}</text>
    {/each}
    {#if medianPath}
      <path class="median" d={medianPath} />
    {/if}
    {#each points as p (p.r.id)}
      <path class="pt {p.tone}" d={hexPath(p.px, p.py, hover === p.i ? 7 : 5)} />
    {/each}
    {#if !readings.length}
      <text class="empty" x={m.left + innerW / 2} y={m.top + innerH / 2} text-anchor="middle" dominant-baseline="middle">
        No readings in this period
      </text>
    {/if}
  </svg>
  {#if hovered}
    <div class="tip" class:left={tipLeft} style:left="{hovered.px}px" style:top="{hovered.py}px">
      <div class="tip-value">{formatValue(hovered.r.mmol, unit)} <span>{unit}</span></div>
      <div class="tip-row"><span class="dot {hovered.tone}"></span>{STATUS_LABEL[statusOf(hovered.r.mmol, targets)]}</div>
      <div class="tip-muted">{fmtDateTime(hovered.r.time)}</div>
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
  .median {
    fill: none;
    stroke: var(--ink-2);
    stroke-width: 2;
    stroke-linecap: round;
    opacity: 0.8;
  }
  .pt {
    stroke: var(--paper);
    stroke-width: 2;
    stroke-linejoin: round;
    opacity: 0.85;
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
    min-width: 140px;
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
  }
  .tip-muted {
    color: var(--ink-2);
  }
</style>
