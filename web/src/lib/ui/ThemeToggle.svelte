<script lang="ts">
  import { theme } from '../stores/theme.svelte';
</script>

<button
  class="toggle"
  type="button"
  onclick={() => theme.toggle()}
  title={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
  aria-label={theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
>
  {theme.resolved === 'dark' ? '☀' : '☾'}
</button>

<style>
  .toggle {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    font-size: 1rem;
    transition: border-color var(--transition);
  }
  .toggle:hover {
    border-color: var(--accent);
  }
</style>
