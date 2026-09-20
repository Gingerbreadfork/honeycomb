<script lang="ts">
  import { qrShape } from '../lib/qr';

  let { text, label, pixels = 168 }: { text: string; label: string; pixels?: number } = $props();

  const QUIET = 4;
  const shape = $derived(qrShape(text));
  const box = $derived(shape.size + QUIET * 2);
</script>

<!-- Black on white in both themes; scanners struggle with inverted codes. -->
<svg class="qr" width={pixels} height={pixels} viewBox="0 0 {box} {box}" role="img" aria-label={label} shape-rendering="crispEdges">
  <rect width={box} height={box} fill="#fff" />
  <path d={shape.path} transform="translate({QUIET} {QUIET})" fill="#000" />
</svg>

<style>
  .qr {
    display: block;
    border-radius: 8px;
    flex: none;
  }
</style>
