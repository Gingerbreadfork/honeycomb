<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatValue } from '../lib/glucose';
  import { computeStats, filterRange } from '../lib/stats';
  import { addDays, fmtRange, startOfDay } from '../lib/time';
  import EntryPanel from '../components/EntryPanel.svelte';
  import ReadingList from '../components/ReadingList.svelte';
  import ReadingsChart from '../components/charts/ReadingsChart.svelte';

  let limit = $state(60);

  const unit = $derived(app.settings.unit);
  const targets = $derived(app.settings.targets);
  const newest = $derived(app.readings.length ? app.readings[app.readings.length - 1].time : null);
  const thisWeekFrom = $derived(startOfDay(addDays(app.now, -6)));
  const stale = $derived(newest !== null && newest < thisWeekFrom);
  const anchor = $derived(stale && newest ? newest : app.now);
  const from = $derived(startOfDay(addDays(anchor, -6)));
  const to = $derived(addDays(startOfDay(anchor), 1));
  const week = $derived(filterRange(app.readings, from, to));
  const stats = $derived(computeStats(week, targets, 7));

  // The newest `limit` readings, extended to the start of the oldest day shown so no day is cut in half.
  const listed = $derived.by(() => {
    const all = app.readings;
    if (all.length <= limit) return all;
    const cutoff = startOfDay(all[all.length - limit].time).getTime();
    return all.filter((r) => r.time.getTime() >= cutoff);
  });
  const olderCount = $derived(app.readings.length - listed.length);

  const heading = $derived(stale ? 'Latest week' : 'This week');
  const summary = $derived.by(() => {
    if (!stats.count || stats.mean === null || !stats.tir) return 'No readings yet this week';
    const pct = Math.round(stats.tir.inRange * 100);
    const counts = `${stats.count} reading${stats.count === 1 ? '' : 's'}, average ${formatValue(stats.mean, unit)} ${unit}, ${pct}% in range`;
    return stale ? `${fmtRange(from, addDays(to, -1))}. ${counts}` : counts;
  });
</script>

<div class="log">
  <aside>
    <EntryPanel />
  </aside>
  <section class="feed">
    <div class="scroll">
      <header class="week">
        <div>
          <h2 class="display">{heading}</h2>
          <p class="muted">{summary}</p>
        </div>
        <button type="button" class="btn small ghost" onclick={() => (app.page = 'trends')}>See trends</button>
      </header>

      <ReadingsChart readings={week} {from} {to} {targets} {unit} height={196} compact />

      <div class="entries">
        {#if app.readings.length}
          <ReadingList readings={listed} />
          {#if olderCount > 0}
            <button type="button" class="btn ghost more" onclick={() => (limit += 60)}>
              Show older readings ({olderCount})
            </button>
          {/if}
        {:else}
          <div class="empty">
            <p class="lead">Your readings will appear here.</p>
            <p class="muted">Each one is saved straight away to a file you own, so nothing is ever lost.</p>
            <div class="empty-actions">
              <button type="button" class="btn small" onclick={() => app.chooseImport()}>Import an exported file</button>
              <button type="button" class="btn small ghost" onclick={() => (app.settingsOpen = true)}>Pair another computer</button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </section>
</div>

<style>
  .log {
    display: grid;
    grid-template-columns: 372px 1fr;
    height: 100%;
  }
  aside {
    position: relative;
    background: var(--card);
    border-right: 1px solid var(--line);
    min-height: 0;
    overflow: auto;
  }
  aside::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='31.18' height='54' viewBox='0 0 31.18 54'%3E%3Cpath d='M15.59 0L31.18 9V27L15.59 36L0 27V9ZM15.59 36V54' fill='none' stroke='%23d9a441' stroke-width='1'/%3E%3C/svg%3E");
    background-size: 31.18px 54px;
    background-position: -8px -10px;
    opacity: var(--mesh-opacity);
    -webkit-mask-image: linear-gradient(180deg, #000 0%, #000 30%, transparent 78%);
    mask-image: linear-gradient(180deg, #000 0%, #000 30%, transparent 78%);
  }
  .feed {
    min-width: 0;
    min-height: 0;
  }
  .scroll {
    height: 100%;
    overflow: auto;
    padding: 18px 30px 32px;
  }
  .week {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 21px;
  }
  .week p {
    font-size: 13px;
    margin-top: 2px;
  }
  .entries {
    margin-top: 26px;
  }
  .more {
    width: 100%;
    margin-top: 14px;
  }
  .empty {
    padding: 36px 10px;
    text-align: center;
  }
  .lead {
    font-family: var(--font-display);
    font-variation-settings: 'opsz' 32, 'wdth' 100;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-bottom: 4px;
  }
  .empty .muted {
    font-size: 13.5px;
  }
  .empty-actions {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
  }
  @media (max-width: 860px) {
    .log {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }
    aside {
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
  }
  :global(.app.mobile) .log {
    display: flex;
    flex-direction: column;
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  :global(.app.mobile) aside {
    flex: none;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  :global(.app.mobile) .feed {
    flex: none;
  }
  :global(.app.mobile) .scroll {
    height: auto;
    overflow: visible;
    padding: 16px 16px 28px;
  }
  :global(.app.mobile) .week {
    margin-bottom: 4px;
  }
  :global(.app.mobile) h2 {
    font-size: 19px;
  }
</style>
