<script lang="ts">
  import { app, type Clock, type Theme } from '../lib/store.svelte';
  import { DEFAULT_TARGETS, formatValue, roundForUnit, targetsProblem, toMmol, type Unit, UNITS } from '../lib/glucose';
  import { isDesktop, pickSavePath, reveal } from '../lib/platform';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import DevicesSection from './DevicesSection.svelte';
  import AboutSection from './AboutSection.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const unit = $derived(app.settings.unit);
  let low = $state(formatValue(app.settings.targets.low, app.settings.unit));
  let high = $state(formatValue(app.settings.targets.high, app.settings.unit));
  let name = $state(app.settings.name);
  let targetError = $state<string | null>(null);

  function setUnit(u: Unit): void {
    void app.updateSettings({ unit: u });
    targetError = null;
    low = formatValue(app.settings.targets.low, u);
    high = formatValue(app.settings.targets.high, u);
  }

  function commitTargets(): void {
    const l = roundForUnit(Number(low.trim().replace(',', '.') || NaN), unit);
    const h = roundForUnit(Number(high.trim().replace(',', '.') || NaN), unit);
    targetError = targetsProblem(l, h, unit);
    if (targetError) return;
    void app.updateSettings({ targets: { low: toMmol(l, unit), high: toMmol(h, unit) } });
    low = formatValue(app.settings.targets.low, unit);
    high = formatValue(app.settings.targets.high, unit);
  }

  function resetTargets(): void {
    void app.updateSettings({ targets: { ...DEFAULT_TARGETS } });
    targetError = null;
    low = formatValue(DEFAULT_TARGETS.low, unit);
    high = formatValue(DEFAULT_TARGETS.high, unit);
  }

  async function changeFile(): Promise<void> {
    const path = await pickSavePath(app.dataPath || 'readings.csv');
    if (!path) return;
    await app.updateSettings({ dataFile: path });
    const name = path.split('/').pop();
    app.toast(app.sync.configured ? `Now using ${name}. Paired devices will sync their readings into it.` : `Now using ${name}`);
  }

  async function useDefault(): Promise<void> {
    await app.updateSettings({ dataFile: null });
    app.toast('Using the default file');
  }

  const clocks: { id: Clock; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: '12h', label: '12-hour' },
    { id: '24h', label: '24-hour' },
  ];
  const themes: { id: Theme; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
  ];
  const defaultsText = $derived(
    `${formatValue(DEFAULT_TARGETS.low, unit)} to ${formatValue(DEFAULT_TARGETS.high, unit)} ${unit}`,
  );
</script>

<Dialog title="Settings" width={540} {onclose}>
  <div class="sections">
    <section>
      <div class="head">
        <h3>Units</h3>
        <p>Readings already saved are shown converted.</p>
      </div>
      <div class="seg">
        {#each UNITS as u (u)}
          <button type="button" aria-pressed={unit === u} onclick={() => setUnit(u)}>{u}</button>
        {/each}
      </div>
    </section>

    <section>
      <div class="head">
        <h3>Target range</h3>
        <p>Readings between these count as in range. The usual target is {defaultsText}.</p>
      </div>
      <div class="pair">
        <input class="field tnum" inputmode="decimal" bind:value={low} onchange={commitTargets} aria-label="Low target" />
        <span class="to">to</span>
        <input class="field tnum" inputmode="decimal" bind:value={high} onchange={commitTargets} aria-label="High target" />
        <span class="unit">{unit}</span>
        <button type="button" class="btn small ghost" onclick={resetTargets}>Reset</button>
      </div>
      {#if targetError}
        <p class="problem" role="alert">{targetError}</p>
      {/if}
    </section>

    <section>
      <div class="head"><h3>Clock</h3></div>
      <div class="seg">
        {#each clocks as c (c.id)}
          <button type="button" aria-pressed={app.settings.clock === c.id} onclick={() => app.updateSettings({ clock: c.id })}>{c.label}</button>
        {/each}
      </div>
    </section>

    <section>
      <div class="head"><h3>Appearance</h3></div>
      <div class="seg">
        {#each themes as t (t.id)}
          <button type="button" aria-pressed={app.settings.theme === t.id} onclick={() => app.updateSettings({ theme: t.id })}>{t.label}</button>
        {/each}
      </div>
    </section>

    <section>
      <div class="head">
        <h3>Name on reports</h3>
        <p>Printed at the top of the doctor's report.</p>
      </div>
      <input class="field name" bind:value={name} onchange={() => app.updateSettings({ name: name.trim() })} placeholder="Optional" />
    </section>

    <section>
      <div class="head">
        <h3>Where readings are kept</h3>
        <p>A plain text file you can open in any spreadsheet. Import an exported file to bring readings onto a new computer, or point Honeycomb at a file you already have.</p>
      </div>
      <div class="path" title={app.dataPath}>{app.dataPath}</div>
      <div class="row">
        <button type="button" class="btn small" onclick={() => app.chooseImport()}><Icon name="download" size={14} /> Import a file</button>
        {#if isDesktop}
          <button type="button" class="btn small" onclick={() => reveal(app.dataPath)}><Icon name="folder" size={14} /> Show in folder</button>
          <button type="button" class="btn small" onclick={changeFile}>Choose another file</button>
        {/if}
        {#if app.settings.dataFile}
          <button type="button" class="btn small ghost" onclick={useDefault}>Use default</button>
        {/if}
      </div>
    </section>

    <DevicesSection />

    {#if isDesktop}
    <section class="keys">
      <div class="head"><h3>Keyboard</h3></div>
      <dl>
        <dt><kbd>Enter</kbd></dt>
        <dd>Save the reading</dd>
        <dt><kbd>Ctrl</kbd><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></dt>
        <dd>Log, Trends, Report</dd>
        <dt><kbd>Ctrl</kbd><kbd>,</kbd></dt>
        <dd>Settings</dd>
        <dt><kbd>Ctrl</kbd><kbd>Q</kbd></dt>
        <dd>Quit</dd>
      </dl>
    </section>
    {/if}

    <AboutSection />
  </div>
</Dialog>

<style>
  .sections {
    display: flex;
    flex-direction: column;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 0;
  }
  .sections > :global(* + *) {
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  p {
    font-size: 13px;
    color: var(--ink-2);
    max-width: 52ch;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .pair input {
    width: 76px;
    text-align: center;
  }
  .problem {
    font-size: 13px;
    color: var(--danger-text);
  }
  .to,
  .unit {
    color: var(--ink-2);
    font-size: 13px;
  }
  .name {
    width: 260px;
  }
  .path {
    font-size: 12.5px;
    color: var(--ink-2);
    background: var(--card-2);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    word-break: break-all;
    user-select: text;
    -webkit-user-select: text;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 16px;
    margin: 0;
    font-size: 13px;
    color: var(--ink-2);
  }
  dt {
    display: flex;
    gap: 3px;
  }
  kbd {
    font: inherit;
    font-size: 11.5px;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--card-2);
    color: var(--ink);
    box-shadow: inset 0 -1px 0 var(--line-strong);
  }
  dd {
    margin: 0;
  }
</style>
