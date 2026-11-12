<script lang="ts">
  import { app } from '../lib/store.svelte';
  import Dialog from './Dialog.svelte';

  const leave = $derived(app.leaving);
</script>

{#if leave}
  <Dialog title="Quit without saving?" width={420} onclose={() => (app.leaving = null)}>
    <p class="text">{app.saveProblem}</p>
    <p class="text">Anything entered since the last save is lost if you quit now.</p>
    {#snippet footer()}
      <button
        type="button"
        class="btn"
        onclick={() => {
          app.leaving = null;
          leave();
        }}>Quit anyway</button
      >
      <button type="button" class="btn primary" data-autofocus onclick={() => (app.leaving = null)}>Stay</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .text {
    font-size: 14px;
    color: var(--ink-2);
    overflow-wrap: anywhere;
  }
  .text + .text {
    margin-top: 10px;
  }
</style>
