<script lang="ts">
  import { app, type Page } from '../lib/store.svelte';
  import Icon from './Icon.svelte';

  const tabs: { id: Page; label: string; icon: string }[] = [
    { id: 'log', label: 'Log', icon: 'log' },
    { id: 'trends', label: 'Trends', icon: 'trends' },
    { id: 'report', label: 'Report', icon: 'report' },
  ];
</script>

<nav class="tabs" aria-label="Pages">
  {#each tabs as t (t.id)}
    <button type="button" aria-pressed={app.page === t.id} onclick={() => (app.page = t.id)}>
      <Icon name={t.icon} size={20} />
      <span>{t.label}</span>
    </button>
  {/each}
  <button type="button" aria-pressed={app.settingsOpen} onclick={() => (app.settingsOpen = true)}>
    <Icon name="gear" size={20} />
    <span>Settings</span>
  </button>
</nav>

<style>
  .tabs {
    flex: none;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--card);
    border-top: 1px solid var(--line);
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
  }
  button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 6px 0 4px;
    border-radius: var(--radius-sm);
    color: var(--ink-3);
    font-size: 11.5px;
    font-weight: 500;
  }
  button[aria-pressed='true'] {
    color: var(--accent);
  }
  button:active {
    background: var(--card-2);
  }
</style>
