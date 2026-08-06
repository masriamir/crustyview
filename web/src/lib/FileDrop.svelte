<script lang="ts">
  interface Props { onfile: (file: File) => void; }
  let { onfile }: Props = $props();
  let dragging = $state(false);
  let input: HTMLInputElement;

  function pick(files: FileList | null | undefined): void {
    const file = files?.[0];
    if (file) onfile(file);
  }
</script>

<div
  class="drop"
  class:dragging
  role="button"
  tabindex="0"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => { e.preventDefault(); dragging = false; pick(e.dataTransfer?.files); }}
  onclick={() => input.click()}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } }}
>
  <p>Drop a WAD here, or click to browse.</p>
  <input bind:this={input} type="file" accept=".wad,.WAD" hidden onchange={(e) => { pick(e.currentTarget.files); e.currentTarget.value = ''; }} />
</div>
