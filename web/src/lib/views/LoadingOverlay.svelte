<script lang="ts">
  import { wad } from '../stores/wad.svelte';
</script>

<!-- Visual only. The status bar's `role="status"` region already announces the
     load; announcing it twice would talk over the rest of the bar. -->
<div class="overlay" aria-hidden="true">
  <p>Loading{wad.loadingFileName ? ` ${wad.loadingFileName}` : ''}…</p>
</div>

<style>
  /* The 250ms delay is load-bearing, not decoration. Everything after
     `await file.arrayBuffer()` in WadStore.load is synchronous, so the main
     thread is blocked through the tail of every load (~100ms on a 125MB WAD)
     and a setTimeout gate could not fire until after the load it was meant to
     cover. Opacity animates on the compositor, which keeps its own clock while
     the main thread is frozen: a fast load unmounts this before it is ever
     painted, and only a genuinely slow one reveals it (#57). */
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--bg);
    color: var(--text-muted);
    opacity: 0;
    animation: reveal 150ms ease-out 250ms forwards;
  }
  @keyframes reveal {
    to {
      opacity: 1;
    }
  }
  /* Deliberately not `animation: none` — that would pin opacity at 0 and delete
     the affordance outright for these users. Keep the delay gate, drop the fade. */
  @media (prefers-reduced-motion: reduce) {
    .overlay {
      animation: reveal 1ms linear 250ms forwards;
    }
  }
</style>
