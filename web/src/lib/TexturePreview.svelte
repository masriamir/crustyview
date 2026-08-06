<script lang="ts">
  import type { TextureMeta } from './format';
  interface Props { meta: TextureMeta | null; rgba: () => Uint8Array | null; }
  let { meta, rgba }: Props = $props();
  let canvas: HTMLCanvasElement;

  $effect(() => {
    const m = meta; // track the reactive prop
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!m || m.width <= 0 || m.height <= 0) return;
    const pixels = rgba();
    if (!pixels) return;
    canvas.width = m.width;
    canvas.height = m.height;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), m.width, m.height),
      0,
      0,
    );
  });
</script>

<section class="texture">
  <h2>First texture</h2>
  <p class="name">{meta ? `${meta.name} — ${meta.width}×${meta.height}` : '— none —'}</p>
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas bind:this={canvas} class="tex" role="img" aria-label="Composited first-texture preview"></canvas>
</section>
