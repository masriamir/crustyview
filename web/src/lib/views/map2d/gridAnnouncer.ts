/**
 * The debounce/baseline machine behind the grid live region, extracted from
 * Map2d.svelte's draw() so the #127-class logic lives outside renderer-bound
 * code (#175). The component owns the reactive live-region string; this owns
 * the timer, the pending text, and the drawable baseline.
 *
 * The one rule that keeps #127 fixed: nothing in the reactive graph cleans
 * this timer up. The component calls dispose() from onDestroy and nowhere
 * else — deliberately NOT from the redraw effect's teardown, which re-runs on
 * every transform change and would cancel a transition mid-gesture.
 */
export const GRID_ANNOUNCE_DELAY_MS = 500;

export interface GridAnnouncer {
  /** A map switch is not a grid transition: reset and silence (#131). */
  observeMap(name: string): void;
  /** One draw's observation. `text` describes where the zoom landed (#76). */
  observe(shown: boolean, drawable: boolean, text: string): void;
  /**
   * Immediate feedback (the grid-size keys). With `baseline`, also stands a
   * pending transition down and moves the drawable baseline — the with-
   * transform press. Without it, the pending transition is left alone: with
   * no transform there is nothing to re-baseline against.
   */
  announceNow(text: string, baseline?: boolean): void;
  /** Unmount: cancel without announcing. */
  dispose(): void;
}

export function createGridAnnouncer(
  announce: (text: string) => void,
  delayMs: number = GRID_ANNOUNCE_DELAY_MS,
): GridAnnouncer {
  let timer = 0;
  let pendingText = '';
  let baseline: boolean | null = null;
  let mapName: string | null = null;

  const cancel = (): void => {
    if (timer !== 0) {
      window.clearTimeout(timer);
      timer = 0;
    }
  };

  return {
    observeMap(name: string): void {
      if (name === mapName) return;
      mapName = name;
      baseline = null;
      pendingText = '';
      cancel();
      // Clearing the region is load-bearing, not tidiness: two maps can
      // produce the identical string, and a stale value would make the next
      // genuine crossing a no-op write that announces nothing (#131).
      announce('');
    },

    observe(shown: boolean, drawable: boolean, text: string): void {
      if (!shown) {
        // Hidden: no drawable state to track, and a pending transition would
        // land after the toggle's own announcement, describing a grid that is
        // no longer shown.
        cancel();
        baseline = null;
        return;
      }
      if (baseline !== null && baseline !== drawable) {
        // A genuine crossing restarts the window.
        pendingText = text;
        cancel();
        timer = window.setTimeout(() => {
          timer = 0;
          announce(pendingText);
        }, delayMs);
      } else if (timer !== 0) {
        // Refresh the text so the callback announces the latest state, but
        // leave the timer alone — zoom ticks must not extend the window.
        pendingText = text;
      }
      baseline = drawable;
    },

    announceNow(text: string, newBaseline?: boolean): void {
      if (newBaseline !== undefined) {
        // This press announces immediately, so a debounced transition must
        // not land on top of it, and the baseline moves to what it describes.
        cancel();
        baseline = newBaseline;
      }
      announce(text);
    },

    dispose(): void {
      cancel();
    },
  };
}
