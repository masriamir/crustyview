<script lang="ts">
  import { summaryRows, type WadSummary } from './format';
  interface Props { summary: WadSummary; mapNames: string[]; fileName: string | null; }
  let { summary, mapNames, fileName }: Props = $props();
  const rows = $derived(summaryRows(summary));
</script>

<section class="stats">
  <h2>Summary</h2>
  <dl>
    {#if fileName}
      <dt>File</dt>
      <dd class="filename">{fileName}</dd>
    {/if}
    {#each rows as row (row.label)}
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    {/each}
  </dl>
  {#if mapNames.length > 0}
    <h3>Maps ({mapNames.length})</h3>
    <ul class="maps">
      {#each mapNames as name}<li>{name}</li>{/each}
    </ul>
  {/if}
</section>
