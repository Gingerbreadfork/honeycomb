<script lang="ts">
  let {
    label,
    value,
    unit = '',
    sub = '',
    delta = '',
  }: { label: string; value: string; unit?: string; sub?: string; delta?: string } = $props();
</script>

<div class="tile">
  <div class="label">{label}</div>
  <div class="value">
    {value}{#if unit}<span class="unit">{unit}</span>{/if}
  </div>
  {#if delta || sub}
    <div class="sub">
      {#if delta}<span class="delta tnum">{delta}</span>{/if}
      {sub}
    </div>
  {/if}
</div>

<style>
  .tile {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .label {
    font-size: 13px;
    color: var(--ink-2);
  }
  .value {
    font-size: 27px;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.15;
    color: var(--ink);
    white-space: nowrap;
  }
  .unit {
    margin-left: 5px;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink-2);
    letter-spacing: 0;
  }
  .sub {
    font-size: 12.5px;
    color: var(--ink-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .delta {
    color: var(--ink-2);
    font-weight: 500;
    margin-right: 4px;
  }
</style>
