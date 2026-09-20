<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { contextLabel, formatValue, STATUS_LABEL, statusOf, toneOf, type Reading } from '../lib/glucose';
  import { groupByDay } from '../lib/stats';
  import { fmtDayHeading, fmtTime } from '../lib/time';
  import Icon from './Icon.svelte';

  let { readings }: { readings: Reading[] } = $props();

  const groups = $derived(groupByDay(readings));
  const unit = $derived(app.settings.unit);
  const targets = $derived(app.settings.targets);

  function summary(rs: Reading[]): string {
    const mean = rs.reduce((a, r) => a + r.mmol, 0) / rs.length;
    return rs.length === 1 ? '1 reading' : `${rs.length} readings, average ${formatValue(mean, unit)}`;
  }
</script>

<div class="list">
  {#each groups as g (g.key)}
    <section class="day">
      <header>
        <h3>{fmtDayHeading(g.date, app.now)}</h3>
        <span class="sum">{summary(g.readings)}</span>
      </header>
      <ul>
        {#each g.readings as r (r.id)}
          {@const st = statusOf(r.mmol, targets)}
          <li class:fresh={app.lastSaved?.id === r.id}>
            <button type="button" class="row" onclick={() => (app.editing = r)} title="Edit reading">
              <span class="time tnum">{fmtTime(r.time)}</span>
              <span class="val tnum">{formatValue(r.mmol, unit)}</span>
              <span class="st"><span class="dot {toneOf(st)}"></span>{STATUS_LABEL[st]}</span>
              <span class="ctx">{contextLabel(r.context)}</span>
              <span class="note">{r.note}</span>
            </button>
            <button type="button" class="del" aria-label="Delete reading" title="Delete" onclick={() => app.remove(r.id)}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 10px 8px;
    border-bottom: 1px solid var(--line-strong);
  }
  h3 {
    font-family: var(--font-ui);
    font-weight: 600;
    font-size: 16.5px;
    letter-spacing: -0.01em;
  }
  .sum {
    font-size: 12.5px;
    color: var(--ink-3);
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    position: relative;
    border-radius: var(--radius-sm);
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  li.fresh {
    animation: fresh 1.8s var(--ease-out);
  }
  .row {
    display: grid;
    grid-template-columns: 78px 64px 108px 118px 1fr;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 42px;
    padding: 0 10px;
    text-align: left;
    color: var(--ink);
    transition: background var(--t-fast) var(--ease-out);
  }
  .row:hover {
    background: var(--card-2);
  }
  .time {
    color: var(--ink-2);
  }
  .val {
    font-size: 16px;
    font-weight: 600;
  }
  .st {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--ink-2);
    font-size: 13.5px;
  }
  .ctx {
    color: var(--ink-2);
    font-size: 13.5px;
  }
  .note {
    color: var(--ink-3);
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 32px;
  }
  .del {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    color: var(--ink-3);
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out);
  }
  li:hover .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    background: var(--card-3);
    color: var(--ink);
  }
  :global(.app.mobile) .row {
    grid-template-columns: 78px 56px 1fr;
    grid-template-areas:
      'time val st'
      'ctx ctx ctx';
    height: auto;
    min-height: 48px;
    padding: 8px 10px;
    row-gap: 2px;
  }
  :global(.app.mobile) .time {
    grid-area: time;
  }
  :global(.app.mobile) .val {
    grid-area: val;
  }
  :global(.app.mobile) .st {
    grid-area: st;
  }
  :global(.app.mobile) .ctx {
    grid-area: ctx;
    font-size: 13px;
    color: var(--ink-3);
  }
  :global(.app.mobile) .ctx:empty {
    display: none;
  }
  :global(.app.mobile) .note {
    display: none;
  }
  :global(.app.mobile) .del {
    display: none;
  }
  @keyframes fresh {
    0% {
      background: var(--accent-soft);
    }
    100% {
      background: transparent;
    }
  }
</style>
