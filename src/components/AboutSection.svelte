<script lang="ts">
  import { canSelfUpdate, openLink, type UpdateProgress } from '../lib/platform';
  import { app } from '../lib/store.svelte';

  const repo = 'https://github.com/Gingerbreadfork/honeycomb';
  const version = __APP_VERSION__;

  let checking = $state(false);
  let checked = $state<string | null>(null);

  function go(url: string): void {
    openLink(url).catch((e) => app.toast(`Couldn't open the link: ${String(e)}`));
  }

  function progressText(p: UpdateProgress): string {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    if (p.total && p.downloaded >= p.total) return 'Installing…';
    return p.total ? `Downloading… ${mb(p.downloaded)} of ${mb(p.total)} MB` : `Downloading… ${mb(p.downloaded)} MB`;
  }

  async function check(): Promise<void> {
    checking = true;
    checked = null;
    try {
      checked = (await app.checkForUpdate()) ? null : "You're on the latest version.";
    } catch (e) {
      checked = `Couldn't check: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      checking = false;
    }
  }
</script>

<section>
  <div class="row">
    <svg class="mark" width="40" height="40" viewBox="0 0 22 22" aria-hidden="true">
      <path d="M11 1.6l8.1 4.7v9.4L11 20.4l-8.1-4.7V6.3z" fill="var(--card-3)" stroke="var(--accent)" stroke-opacity="0.6" stroke-width="1" stroke-linejoin="round" />
      <path d="M11 5.6C11.9 8.2 15.1 10.2 15.1 13.2A4.1 4.1 0 0 1 6.9 13.2C6.9 10.2 10.1 8.2 11 5.6Z" fill="var(--accent)" />
    </svg>
    <div>
      <h3>Honeycomb <span class="version tnum">{version}</span></h3>
      <p>A calm blood glucose journal. Free and open source under the MIT licence.</p>
    </div>
  </div>
  <div class="links">
    <button type="button" class="btn small" onclick={() => go(repo)}>Source on GitHub</button>
    <button type="button" class="btn small" onclick={() => go(`${repo}/releases`)}>Releases</button>
    <button type="button" class="btn small ghost" onclick={() => go(`${repo}/issues`)}>Report a problem</button>
  </div>
  <div class="updates">
    <div class="links">
      <button type="button" class="btn small" onclick={check} disabled={checking}>{checking ? 'Checking…' : 'Check for updates'}</button>
      {#if app.updating}
        {@const progress = app.updating}
        <span class="fine" role="status">{progressText(progress)}</span>
      {:else if app.newRelease}
        {@const found = app.newRelease}
        {#if canSelfUpdate}
          <button type="button" class="btn small primary" onclick={() => app.installUpdate()}>Install {found.version} and restart</button>
        {:else}
          <button type="button" class="btn small primary" onclick={() => go(found.url)}>Get {found.version}</button>
        {/if}
      {:else if checked}
        <span class="fine" role="status">{checked}</span>
      {/if}
    </div>
    <label class="toggle">
      <input type="checkbox" checked={app.settings.checkUpdates} onchange={(e) => app.updateSettings({ checkUpdates: e.currentTarget.checked })} />
      <span>
        Check for updates on its own
        <small>
          When Honeycomb starts and every twelve hours while it runs. Asks GitHub for the latest version number; nothing about you or your
          readings is sent.{canSelfUpdate ? ' Nothing installs until you say so.' : ''}
        </small>
      </span>
    </label>
  </div>
  <p class="fine">
    Estimated A1c is calculated from your readings and is not a laboratory result. Talk to your care team about your targets.
  </p>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .mark {
    flex: none;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  .version {
    margin-left: 6px;
    font-weight: 500;
    color: var(--ink-2);
  }
  p {
    font-size: 13px;
    color: var(--ink-2);
    max-width: 52ch;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .links {
    align-items: center;
  }
  .updates {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 13px;
    cursor: pointer;
  }
  .toggle input {
    margin-top: 3px;
    accent-color: var(--accent);
  }
  .toggle small {
    display: block;
    color: var(--ink-3);
    font-size: 12px;
    margin-top: 2px;
  }
  .fine {
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
