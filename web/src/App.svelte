<script lang="ts">
  import Shell from './lib/shell/Shell.svelte';
  import { theme } from './lib/stores/theme.svelte';

  $effect(() => {
    document.documentElement.dataset.theme = theme.resolved;
  });
</script>

<Shell />
