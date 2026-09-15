<script lang="ts">
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'close'}
    <path d="M4 4l8 8M12 4l-8 8" />
  {:else if name === 'minimize'}
    <path d="M3.5 8.5h9" />
  {:else if name === 'maximize'}
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
  {:else if name === 'restore'}
    <path d="M5.5 5.5V4.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
    <rect x="3.5" y="5.5" width="7" height="7" rx="1" />
  {:else if name === 'gear'}
    <path d="M6.9 1.8h2.2l.35 1.6a5 5 0 0 1 1.3.75l1.55-.55 1.1 1.9-1.2 1.05a5 5 0 0 1 0 1.5l1.2 1.05-1.1 1.9-1.55-.55a5 5 0 0 1-1.3.75l-.35 1.6H6.9l-.35-1.6a5 5 0 0 1-1.3-.75l-1.55.55-1.1-1.9 1.2-1.05a5 5 0 0 1 0-1.5L2.6 5.5l1.1-1.9 1.55.55a5 5 0 0 1 1.3-.75z" />
    <circle cx="8" cy="8" r="1.9" />
  {:else if name === 'pencil'}
    <path d="M11.3 2.7l2 2L5.5 12.5 3 13l.5-2.5z" />
  {:else if name === 'trash'}
    <path d="M3 4.5h10M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
  {:else if name === 'check'}
    <path d="M3 8.5l3 3 7-7" />
  {:else if name === 'chevron-down'}
    <path d="M4 6l4 4 4-4" />
  {:else if name === 'clock'}
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.3 1.5" />
  {:else if name === 'copy'}
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  {:else if name === 'download'}
    <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3 13.5h10" />
  {:else if name === 'print'}
    <path d="M4.5 6V2.5h7V6M4.5 11h-1a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1" />
    <rect x="4.5" y="9.5" width="7" height="4" />
  {:else if name === 'folder'}
    <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
  {:else if name === 'plus'}
    <path d="M8 3v10M3 8h10" />
  {:else if name === 'arrow-right'}
    <path d="M3 8h10M9 4l4 4-4 4" />
  {:else if name === 'enter'}
    <path d="M13 3.5v4a1.5 1.5 0 0 1-1.5 1.5H3.5M6 6l-3 3 3 3" />
  {:else if name === 'devices'}
    <rect x="1.5" y="3.5" width="9" height="7" rx="1.5" />
    <path d="M4 13h4M6 10.5V13" />
    <rect x="11.5" y="6" width="3" height="7" rx="1" />
  {:else if name === 'refresh'}
    <path d="M13 8a5 5 0 0 1-8.6 3.5M3 8a5 5 0 0 1 8.6-3.5" />
    <path d="M11.5 1.8v2.9h-2.9M4.5 14.2v-2.9h2.9" />
  {:else if name === 'log'}
    <path d="M3 4.5h10M3 8h10M3 11.5h6" />
  {:else if name === 'trends'}
    <path d="M2.5 11.5l3.2-3.6 2.6 2.2 5.2-5.6" />
    <path d="M10.5 4.5h3v3" />
  {:else if name === 'report'}
    <path d="M4 2.5h5.5L13 6v7.5H4z" />
    <path d="M9.5 2.5V6H13M6 9h5M6 11.5h3.5" />
  {:else if name === 'dots'}
    <circle cx="3.5" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
    <circle cx="12.5" cy="8" r="1" fill="currentColor" stroke="none" />
  {/if}
</svg>
