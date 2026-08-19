/**
 * Renders a fatal startup failure into the app's mount point (#188).
 *
 * Extracted from `main.ts` so it can be tested in the fast tier: this is plain
 * DOM manipulation, not a component, so `happy-dom` sees all of it and no
 * browser-tier mount is needed.
 *
 * **Why the message arrives in a second step.** `role="alert"` is an assertive
 * live region, and assistive technology announces it most reliably when the
 * region is already in the accessibility tree *before* its content changes.
 * Inserting a node that already carries both the role and its text is the less
 * reliable shape — some screen readers announce it, some treat it as ordinary
 * inserted content. So the empty region goes in first and the text follows on a
 * later task.
 *
 * Before #188 this path set `target.textContent` directly: no role, no live
 * region, nothing announced. A wasm init failure left a sighted user with a bare
 * line of text and a screen-reader user with a silent blank page.
 */
/**
 * A human-readable description of an arbitrary rejection value.
 *
 * `String(err)` alone renders `[object Object]` for a plain-object rejection,
 * which is the least useful thing this screen could say: its entire job is to
 * give someone something to paste into a bug report. Anything JSON can
 * serialize is shown as JSON instead; the `String` fallback still covers
 * circular structures (where `JSON.stringify` throws) and values it returns
 * `undefined` for, such as functions and `undefined` itself.
 */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    const json = JSON.stringify(err);
    if (typeof json === 'string') return json;
  } catch {
    // Circular or otherwise unserializable — fall through to String().
  }
  return String(err);
}

export function renderStartupFailure(target: HTMLElement, err: unknown): void {
  const message = messageOf(err);
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  // Replaces the mount point's contents: this is terminal, and whatever was
  // there (nothing, or a half-mounted app) must not stay alongside the error.
  target.replaceChildren(alert);
  setTimeout(() => {
    alert.textContent = `Failed to start: ${message}`;
  }, 0);
}
