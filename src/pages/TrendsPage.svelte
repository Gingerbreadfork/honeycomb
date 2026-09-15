<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatSigned, formatValue } from '../lib/glucose';
  import { computeStats, filterRange, tirBuckets } from '../lib/stats';
  import { addDays, fmtDateTime, fmtLongDate, fmtRange } from '../lib/time';
  import ReadingsChart from '../components/charts/ReadingsChart.svelte';
  import DayPatternChart from '../components/charts/DayPatternChart.svelte';
  import RangeBar from '../components/charts/RangeBar.svelte';
  import RangeColumns from '../components/charts/RangeColumns.svelte';
  import StatTile from '../components/charts/StatTile.svelte';
  import RangePicker from '../components/RangePicker.svelte';
  import { RangeState } from '../lib/range.svelte';

  const range = new RangeState(14);

  const unit = $derived(app.settings.unit);
  const targets = $derived(app.settings.targets);
  const resolved = $derived(range.resolve(app.now, app.readings));
  const from = $derived(resolved.from);
  const to = $derived(resolved.to);
  const spanDays = $derived(resolved.spanDays);
  const days = $derived(range.custom ? 0 : range.days);
  const current = $derived(filterRange(app.readings, from, to));
  const previous = $derived(range.custom || days ? filterRange(app.readings, addDays(from, -spanDays), from) : []);
  const stats = $derived(computeStats(current, targets, spanDays));
  const prev = $derived(computeStats(previous, targets, spanDays));
  const byWeek = $derived(spanDays > 21);
  const buckets = $derived(tirBuckets(current, targets, from, to, byWeek));

  const prevLabel = $derived(range.custom ? `vs previous ${spanDays} days` : days ? `vs previous ${days} days` : '');
  const avgDelta = $derived(
    stats.mean !== null && prev.mean !== null ? formatSigned(stats.mean - prev.mean, unit) : '',
  );
  const tirDelta = $derived.by(() => {
    if (!stats.tir || !prev.tir) return '';
    const d = Math.round((stats.tir.inRange - prev.tir.inRange) * 100);
    return d === 0 ? '0 pts' : `${d > 0 ? '+' : '−'}${Math.abs(d)} pts`;
  });
  const perDay = $derived(stats.perDay >= 10 ? Math.round(stats.perDay) : Math.round(stats.perDay * 10) / 10);
  const newest = $derived(app.readings.length ? app.readings[app.readings.length - 1].time : null);
  const emptyButOlder = $derived((range.custom || days !== 0) && current.length === 0 && newest !== null);
</script>

<div class="trends">
  <div class="scroll">
    <header class="top">
      <div>
        <h2 class="display">Trends</h2>
        <p class="muted">
          {fmtRange(from, addDays(to, -1))}, {stats.count} reading{stats.count === 1 ? '' : 's'}
        </p>
      </div>
      <RangePicker {range} {resolved} />
    </header>

    {#if emptyButOlder && newest}
      <div class="notice">
        <span>No readings in this period. The latest is from {fmtLongDate(newest)}.</span>
        <button type="button" class="btn small" onclick={() => range.setCustom(addDays(newest, -29), newest)}>Latest 30 days</button>
        <button type="button" class="btn small ghost" onclick={() => range.setPreset(0)}>Show all</button>
      </div>
    {/if}

    <div class="tiles">
      <StatTile
        label="Average"
        value={stats.mean !== null ? formatValue(stats.mean, unit) : '—'}
        unit={stats.mean !== null ? unit : ''}
        delta={avgDelta}
        sub={avgDelta ? prevLabel : ''}
      />
      <StatTile
        label="Time in range"
        value={stats.tir ? `${Math.round(stats.tir.inRange * 100)}%` : '—'}
        delta={tirDelta}
        sub={tirDelta ? prevLabel : ''}
      />
      <StatTile label="Estimated A1c" value={stats.a1c !== null ? `${stats.a1c.toFixed(1)}%` : '—'} sub={stats.a1c !== null ? 'from average glucose' : 'needs a few readings'} />
      <StatTile label="Readings" value={String(stats.count)} sub={stats.count ? `${perDay} a day` : ''} />
      <StatTile
        label="Lowest"
        value={stats.min ? formatValue(stats.min.mmol, unit) : '—'}
        unit={stats.min ? unit : ''}
        sub={stats.min ? fmtDateTime(stats.min.time, app.now) : ''}
      />
      <StatTile
        label="Highest"
        value={stats.max ? formatValue(stats.max.mmol, unit) : '—'}
        unit={stats.max ? unit : ''}
        sub={stats.max ? fmtDateTime(stats.max.time, app.now) : ''}
      />
      <StatTile
        label="Variability"
        value={stats.cv !== null ? `${Math.round(stats.cv * 100)}%` : '—'}
        sub={stats.cv !== null ? (stats.cv < 0.36 ? 'steady, under 36%' : 'above the 36% goal') : ''}
      />
      <StatTile
        label="Fasting average"
        value={stats.fastingMean !== null ? formatValue(stats.fastingMean, unit) : '—'}
        unit={stats.fastingMean !== null ? unit : ''}
        sub={stats.fastingCount ? `${stats.fastingCount} fasting reading${stats.fastingCount === 1 ? '' : 's'}` : 'no fasting readings'}
      />
    </div>

    <section>
      <h3 class="display">Readings</h3>
      <ReadingsChart readings={current} {from} {to} {targets} {unit} height={260} />
    </section>

    <section>
      <h3 class="display">Time in range</h3>
      <p class="muted">Target {formatValue(targets.low, unit)} to {formatValue(targets.high, unit)} {unit}</p>
      <div class="tir">
        <RangeBar split={stats.tir} counts={stats.tirCounts} />
        <RangeColumns {buckets} {byWeek} />
      </div>
    </section>

    <section>
      <h3 class="display">By time of day</h3>
      <p class="muted">Every reading from this period placed on one day. A line shows the typical level once there is enough data.</p>
      <DayPatternChart readings={current} {targets} {unit} height={250} />
    </section>
  </div>
</div>

<style>
  .trends {
    height: 100%;
  }
  .scroll {
    height: 100%;
    overflow: auto;
    padding: 18px 34px 40px;
  }
  .top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  h2 {
    font-size: 24px;
  }
  .top p {
    font-size: 13px;
    margin-top: 2px;
  }
  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--card-2);
    font-size: 13.5px;
    color: var(--ink-2);
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 22px 28px;
    margin-top: 22px;
    padding: 20px 0 22px;
    border-top: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
  }
  section {
    margin-top: 34px;
  }
  h3 {
    font-size: 19px;
    margin-bottom: 10px;
  }
  section .muted {
    font-size: 13px;
    margin: -6px 0 12px;
  }
  .tir {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  @media (max-width: 900px) {
    .tiles {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  :global(.app.mobile) .scroll {
    padding: 14px 16px 32px;
    -webkit-overflow-scrolling: touch;
  }
  :global(.app.mobile) h2 {
    font-size: 21px;
  }
  :global(.app.mobile) .tiles {
    gap: 16px 18px;
    margin-top: 14px;
    padding: 16px 0;
  }
  :global(.app.mobile) section {
    margin-top: 26px;
  }
</style>
