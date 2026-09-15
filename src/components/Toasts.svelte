<script lang="ts">
  import { fly, fade } from 'svelte/transition';
  import { app } from '../lib/store.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast" in:fly={{ y: 10, duration: 220 }} out:fade={{ duration: 160 }}>
      <span>{t.text}</span>
      {#if t.action}
        {@const action = t.action}
        <button
          type="button"
          onclick={() => {
            action.run();
            app.dismissToast(t.id);
          }}>{action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 60;
    pointer-events: none;
  }
  :global(.app.mobile) .toasts {
    bottom: calc(88px + env(safe-area-inset-bottom));
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px 10px 16px;
    background: var(--popover);
    border-radius: var(--radius);
    box-shadow: var(--shadow-pop);
    font-size: 13.5px;
  }
  .toast button {
    color: var(--accent-strong);
    font-weight: 600;
    padding: 2px 6px;
  }
  .toast button:hover {
    background: var(--accent-soft);
  }
</style>
