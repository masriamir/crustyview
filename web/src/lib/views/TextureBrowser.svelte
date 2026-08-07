<script lang="ts">
  import { wad } from '../stores/wad.svelte';

  let canvas: HTMLCanvasElement;

  $effect(() => {
    const meta = wad.textureMeta;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!meta || meta.width <= 0 || meta.height <= 0) return;
    const pixels = wad.textureRgba();
    if (!pixels) return;
    canvas.width = meta.width;
    canvas.height = meta.height;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), meta.width, meta.height),
      0,
      0,
    );
  });
</script>

<section aria-label="Textures">
  <h2>Textures</h2>
  <p class="note">
    The searchable texture browser arrives with the <code>textureRgba(name)</code>
    contract change; until then this shows the first texture.
  </p>
  <p class="name">
    {wad.textureMeta
      ? `${wad.textureMeta.name} — ${wad.textureMeta.width}×${wad.textureMeta.height}`
      : '— none —'}
  </p>
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas bind:this={canvas} class="tex" role="img" aria-label="Composited first-texture preview"
  ></canvas>
</section>

<style>
  h2 {
    margin: 0 0 0.5rem;
  }
  .note {
    color: var(--text-muted);
    max-width: 40rem;
  }
  .name {
    font-family: var(--font-mono);
  }
  /* Checkerboard so transparent/masked texture pixels stay visible. */
  .tex {
    border: 1px solid var(--border);
    background-color: var(--checker-a);
    background-image:
      linear-gradient(45deg, var(--checker-b) 25%, transparent 25%, transparent 75%, var(--checker-b) 75%),
      linear-gradient(45deg, var(--checker-b) 25%, transparent 25%, transparent 75%, var(--checker-b) 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      8px 8px;
    max-width: 100%;
  }
</style>
