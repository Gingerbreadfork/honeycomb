<script lang="ts">
  import { openLink } from '../lib/platform';
  import { app } from '../lib/store.svelte';

  const repo = 'https://github.com/Gingerbreadfork/honeycomb';
  const version = __APP_VERSION__;

  function go(url: string): void {
    openLink(url).catch((e) => app.toast(`Couldn't open the link: ${String(e)}`));
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
  .fine {
    font-size: 12px;
    color: var(--ink-3);
  }
</style>
