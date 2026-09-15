<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { readingsToCleanCsv } from '../lib/csv';
  import { contextLabel, formatValue, STATUS_LABEL, statusOf, toneOf } from '../lib/glucose';
  import { copyText, exportFile, isMobile, pickSavePath } from '../lib/platform';
  import { computeStats, filterRange, groupByDay } from '../lib/stats';
  import { addDays, dateInputValue, dayKey, fmtDateTime, fmtLongDate, fmtRange, fmtShortDate, fmtTime, fmtWeekday, fromInputs, startOfDay } from '../lib/time';
  import Icon from '../components/Icon.svelte';
  import RangeBar from '../components/charts/RangeBar.svelte';
  import ReadingsChart from '../components/charts/ReadingsChart.svelte';

  const presets = [7, 14, 30, 90];
  let days = $state(30);
  let custom = $state(false);
  let fromText = $state(dateInputValue(addDays(new Date(), -29)));
  let toText = $state(dateInputValue(new Date()));

  const unit = $derived(app.settings.unit);
  const targets = $derived(app.settings.targets);
  const from = $derived.by(() => {
    if (custom) return fromInputs(fromText, '00:00') ?? startOfDay(addDays(app.now, -29));
    return startOfDay(addDays(app.now, -(days - 1)));
  });
  const to = $derived.by(() => {
    if (custom) return addDays(fromInputs(toText, '00:00') ?? startOfDay(app.now), 1);
    return addDays(startOfDay(app.now), 1);
  });
  const last = $derived(addDays(to, -1));
  const spanDays = $derived(Math.max(1, Math.round((to.getTime() - from.getTime()) / 864e5)));
  const rows = $derived(filterRange(app.readings, from, to));
  const stats = $derived(computeStats(rows, targets, spanDays));
  const groups = $derived(groupByDay(rows).reverse());

  function summaryText(): string {
    const lines = [
      `Blood glucose summary, ${fmtRange(from, last)} (${spanDays} days)`,
      app.settings.name ? `Name: ${app.settings.name}` : '',
      `Readings: ${stats.count}${stats.count ? ` (${Math.round(stats.perDay * 10) / 10} a day)` : ''}`,
      stats.mean !== null ? `Average: ${formatValue(stats.mean, unit)} ${unit}` : '',
      stats.tir
        ? `Time in range (${formatValue(targets.low, unit)} to ${formatValue(targets.high, unit)}): ${Math.round(stats.tir.inRange * 100)}%, low ${Math.round(stats.tir.low * 100)}%, high ${Math.round(stats.tir.high * 100)}%`
        : '',
      stats.a1c !== null ? `Estimated A1c: ${stats.a1c.toFixed(1)}%` : '',
      stats.min ? `Lowest: ${formatValue(stats.min.mmol, unit)} ${unit} (${fmtDateTime(stats.min.time, app.now)})` : '',
      stats.max ? `Highest: ${formatValue(stats.max.mmol, unit)} ${unit} (${fmtDateTime(stats.max.time, app.now)})` : '',
      stats.cv !== null ? `Variability (CV): ${Math.round(stats.cv * 100)}%` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  async function copyCsv(): Promise<void> {
    try {
      await copyText(readingsToCleanCsv(rows));
      app.toast('CSV copied');
    } catch (e) {
      app.toast(`Copy failed: ${String(e)}`);
    }
  }

  async function exportCsv(): Promise<void> {
    const name = `glucose-${dayKey(from)}-to-${dayKey(last)}.csv`;
    const path = await pickSavePath(name);
    if (!path) return;
    try {
      await exportFile(path, readingsToCleanCsv(rows));
      app.toast('CSV exported');
    } catch (e) {
      app.toast(`Export failed: ${String(e)}`);
    }
  }

  async function copySummary(): Promise<void> {
    try {
      await copyText(summaryText());
      app.toast('Summary copied');
    } catch (e) {
      app.toast(`Copy failed: ${String(e)}`);
    }
  }

  function savePdf(): void {
    window.print();
  }
</script>

<div class="report">
  <div class="scroll">
    <header class="top">
      <div>
        <h2 class="display">Report</h2>
        <p class="muted">A clean summary to bring to your appointment.</p>
      </div>
      <div class="controls">
        <div class="seg" role="group" aria-label="Period">
          {#each presets as p (p)}
            <button type="button" aria-pressed={!custom && days === p} onclick={() => { custom = false; days = p; }}>{p} days</button>
          {/each}
          <button type="button" aria-pressed={custom} onclick={() => (custom = true)}>Custom</button>
        </div>
        {#if custom}
          <div class="dates">
            <input class="field tnum" type="date" bind:value={fromText} aria-label="From" />
            <span class="muted">to</span>
            <input class="field tnum" type="date" bind:value={toText} aria-label="To" />
          </div>
        {/if}
      </div>
    </header>

    <div class="actions">
      {#if isMobile}
        <button type="button" class="btn primary" onclick={copySummary}><Icon name="copy" size={15} /> Copy summary</button>
        <button type="button" class="btn" onclick={copyCsv}><Icon name="copy" size={15} /> Copy CSV</button>
      {:else}
        <button type="button" class="btn primary" onclick={savePdf}><Icon name="print" size={15} /> Save as PDF</button>
        <button type="button" class="btn" onclick={exportCsv}><Icon name="download" size={15} /> Export CSV</button>
        <button type="button" class="btn" onclick={copySummary}><Icon name="copy" size={15} /> Copy summary</button>
      {/if}
    </div>

    <article class="sheet">
      <header class="sheet-head">
        <div>
          <h1 class="display">Blood glucose report</h1>
          <p class="sub">
            {#if app.settings.name}{app.settings.name}, {/if}{fmtRange(from, last)}
          </p>
        </div>
        <div class="brand">
          <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true">
            <path d="M11 1.6l8.1 4.7v9.4L11 20.4l-8.1-4.7V6.3z" fill="var(--card-3)" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="1" stroke-linejoin="round" />
            <path d="M11 5.6C11.9 8.2 15.1 10.2 15.1 13.2A4.1 4.1 0 0 1 6.9 13.2C6.9 10.2 10.1 8.2 11 5.6Z" fill="var(--accent)" />
          </svg>
          Honeycomb
        </div>
      </header>

      <div class="figures">
        <div class="fig">
          <div class="lbl">Average</div>
          <div class="val">{stats.mean !== null ? formatValue(stats.mean, unit) : '—'}<span>{stats.mean !== null ? unit : ''}</span></div>
        </div>
        <div class="fig">
          <div class="lbl">Time in range</div>
          <div class="val">{stats.tir ? `${Math.round(stats.tir.inRange * 100)}%` : '—'}</div>
        </div>
        <div class="fig">
          <div class="lbl">Estimated A1c</div>
          <div class="val">{stats.a1c !== null ? `${stats.a1c.toFixed(1)}%` : '—'}</div>
        </div>
        <div class="fig">
          <div class="lbl">Readings</div>
          <div class="val">{stats.count}<span>{stats.count ? `${Math.round(stats.perDay * 10) / 10} a day` : ''}</span></div>
        </div>
        <div class="fig">
          <div class="lbl">Lowest</div>
          <div class="val">{stats.min ? formatValue(stats.min.mmol, unit) : '—'}<span>{stats.min ? fmtShortDate(stats.min.time) : ''}</span></div>
        </div>
        <div class="fig">
          <div class="lbl">Highest</div>
          <div class="val">{stats.max ? formatValue(stats.max.mmol, unit) : '—'}<span>{stats.max ? fmtShortDate(stats.max.time) : ''}</span></div>
        </div>
        <div class="fig">
          <div class="lbl">Variability</div>
          <div class="val">{stats.cv !== null ? `${Math.round(stats.cv * 100)}%` : '—'}<span>{stats.cv !== null ? 'CV' : ''}</span></div>
        </div>
        <div class="fig">
          <div class="lbl">Fasting average</div>
          <div class="val">{stats.fastingMean !== null ? formatValue(stats.fastingMean, unit) : '—'}<span>{stats.fastingCount ? `${stats.fastingCount} readings` : ''}</span></div>
        </div>
      </div>

      <div class="block">
        <RangeBar split={stats.tir} counts={stats.tirCounts} thin />
      </div>

      <div class="block chart">
        <ReadingsChart readings={rows} {from} {to} {targets} {unit} height={220} interactive={false} />
      </div>

      {#if groups.length}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th class="num">Glucose</th>
              <th>Status</th>
              <th>Context</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {#each groups as g (g.key)}
              {#each [...g.readings].reverse() as r, i (r.id)}
                {@const st = statusOf(r.mmol, targets)}
                <tr class:first={i === 0}>
                  <td class="date">{i === 0 ? `${fmtWeekday(g.date)} ${fmtShortDate(g.date)}` : ''}</td>
                  <td class="tnum">{fmtTime(r.time)}</td>
                  <td class="num tnum strong">{formatValue(r.mmol, unit)}</td>
                  <td><span class="st"><span class="dot {toneOf(st)}"></span>{STATUS_LABEL[st]}</span></td>
                  <td>{contextLabel(r.context)}</td>
                  <td class="note">{r.note}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="none">No readings in this period.</p>
      {/if}

      <footer>
        Target range {formatValue(targets.low, unit)} to {formatValue(targets.high, unit)} {unit}. Estimated A1c is calculated from the average of these readings and is not a laboratory result. Generated {fmtLongDate(app.now)}.
      </footer>
    </article>
  </div>
</div>

<style>
  .report {
    height: 100%;
  }
  .scroll {
    height: 100%;
    overflow: auto;
    padding: 18px 34px 48px;
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
  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .dates {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin: 18px 0 22px;
  }

  .sheet {
    --paper: oklch(98.5% 0.012 92);
    max-width: 820px;
    margin: 0 auto;
    padding: 40px 44px 36px;
    background: var(--paper);
    color: var(--ink);
    border-radius: 6px;
    box-shadow: 0 1px 2px oklch(0% 0 0 / 0.2), 0 24px 60px -16px oklch(0% 0 0 / 0.45);
    user-select: text;
    -webkit-user-select: text;
  }
  .sheet-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--line-strong);
  }
  h1 {
    font-size: 26px;
  }
  .sub {
    margin-top: 4px;
    color: var(--ink-2);
    font-size: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 32, 'wdth' 100;
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.02em;
    color: var(--ink-2);
    padding-top: 6px;
  }
  .figures {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 18px 20px;
    padding: 22px 0;
  }
  .fig .lbl {
    font-size: 12px;
    color: var(--ink-2);
  }
  .fig .val {
    font-size: 22px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.2;
    white-space: nowrap;
  }
  .fig .val span {
    margin-left: 6px;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-2);
  }
  .block {
    padding: 4px 0 22px;
  }
  .block.chart {
    padding-bottom: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 18px;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--ink-2);
    padding: 6px 8px;
    border-bottom: 1px solid var(--line-strong);
  }
  td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  tr.first td {
    border-top: 1px solid var(--line-strong);
  }
  thead + tbody tr.first:first-child td {
    border-top: 0;
  }
  .num {
    text-align: right;
  }
  .strong {
    font-weight: 600;
  }
  .date {
    color: var(--ink-2);
    white-space: nowrap;
  }
  .st {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .st .dot {
    width: 7px;
    height: 7px;
  }
  .note {
    color: var(--ink-2);
  }
  .none {
    padding: 24px 0;
    color: var(--ink-2);
  }
  footer {
    margin-top: 26px;
    font-size: 11.5px;
    color: var(--ink-3);
    line-height: 1.5;
  }

  :global(.app.mobile) .scroll {
    padding: 14px 12px 32px;
    -webkit-overflow-scrolling: touch;
  }
  :global(.app.mobile) h2 {
    font-size: 21px;
  }
  :global(.app.mobile) .actions {
    flex-wrap: wrap;
    margin: 12px 0 16px;
  }
  :global(.app.mobile) .sheet {
    padding: 22px 18px 20px;
  }
  :global(.app.mobile) .figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 12px;
  }
  :global(.app.mobile) h1 {
    font-size: 21px;
  }
  :global(.app.mobile) table {
    font-size: 12px;
  }
  :global(.app.mobile) th:nth-child(6),
  :global(.app.mobile) td:nth-child(6) {
    display: none;
  }
  :global(.app.mobile) th,
  :global(.app.mobile) td {
    padding-left: 4px;
    padding-right: 4px;
  }
  @media print {
    .scroll {
      height: auto;
      overflow: visible;
      padding: 0;
    }
    .top,
    .actions {
      display: none;
    }
    .sheet {
      max-width: none;
      padding: 0;
      box-shadow: none;
      border-radius: 0;
      background: #fff;
      --paper: #fff;
    }
    tr {
      break-inside: avoid;
    }
  }
</style>
