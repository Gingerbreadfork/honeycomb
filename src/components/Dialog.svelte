<script module lang="ts">
  const stack: symbol[] = [];
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  import { isMobile } from '../lib/platform';

  const me = Symbol();

  let {
    title,
    width = 460,
    onclose,
    children,
    footer,
  }: { title: string; width?: number; onclose: () => void; children: Snippet; footer?: Snippet } = $props();

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && stack[stack.length - 1] === me) {
      e.stopPropagation();
      onclose();
    }
  }

  function focusFirst(node: HTMLElement): () => void {
    stack.push(me);
    const body = node.querySelector<HTMLElement>('.body, footer') ?? node;
    const el = isMobile
      ? node.querySelector<HTMLElement>('[data-autofocus]:not(input):not(textarea)')
      : (node.querySelector<HTMLElement>('[data-autofocus]') ??
        body.querySelector<HTMLElement>('input:not([type=hidden]), textarea, select, button') ??
        node.querySelector<HTMLElement>('footer button'));
    (el ?? node).focus({ preventScroll: true });
    return () => {
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
    };
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<div
  class="scrim"
  role="presentation"
  onpointerdown={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="dialog" class:sheet={isMobile} role="dialog" aria-modal="true" aria-label={title} style:width="{width}px" tabindex="-1" {@attach focusFirst}>
    <header>
      <h2 class="display">{title}</h2>
      <button type="button" class="close" aria-label="Close" onclick={onclose}><Icon name="close" /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--scrim);
    animation: fade-in var(--t-med) var(--ease-out);
    padding: 24px;
  }
  :global(.app.mobile) .scrim {
    padding: 0;
    align-items: flex-end;
  }
  .dialog.sheet {
    width: 100% !important;
    max-height: 92%;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .dialog {
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--popover);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    animation: pop-in var(--t-med) var(--ease-spring);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 16px 10px 24px;
  }
  h2 {
    font-size: 21px;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    color: var(--ink-2);
  }
  .close:hover {
    background: var(--card-2);
    color: var(--ink);
  }
  .body {
    padding: 4px 24px 22px;
    overflow: auto;
    min-height: 0;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 24px 18px;
    border-top: 1px solid var(--line);
  }
</style>
