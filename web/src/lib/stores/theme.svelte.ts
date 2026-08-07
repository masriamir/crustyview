const STORAGE_KEY = 'crustyview-theme';

/** The palette actually in effect. */
export type ResolvedTheme = 'light' | 'dark';

/** User preference: an explicit override, or follow the system. */
export type ThemePreference = ResolvedTheme | 'system';

/**
 * Theme state (ADR-0003): default follows `prefers-color-scheme`; the header
 * toggle overrides it and the override persists in `localStorage`. The
 * matching pre-paint script in `index.html` mirrors this resolution rule.
 */
export class ThemeStore {
  preference = $state<ThemePreference>('system');
  #systemDark = $state(false);

  constructor() {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      // Blocked storage (private mode, storage disabled) — follow the system.
    }
    if (stored === 'light' || stored === 'dark') this.preference = stored;
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    this.#systemDark = query?.matches ?? false;
    query?.addEventListener?.('change', (e) => {
      this.#systemDark = e.matches;
    });
  }

  get resolved(): ResolvedTheme {
    if (this.preference === 'system') return this.#systemDark ? 'dark' : 'light';
    return this.preference;
  }

  /** Override to the opposite of the current palette and persist it. */
  toggle(): void {
    const next: ResolvedTheme = this.resolved === 'dark' ? 'light' : 'dark';
    this.preference = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Blocked storage — the override still applies for this session.
    }
  }
}

export const theme = new ThemeStore();
