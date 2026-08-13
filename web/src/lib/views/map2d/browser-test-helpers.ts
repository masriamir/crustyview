/**
 * Shared setup for the browser-tier tests (#129).
 *
 * `map2d-mount.browser.test.ts` is the template other browser tests get
 * cribbed from, so anything duplicated inside it propagates into every test
 * written after it. Importing this module instead of copy-pasting the setup
 * teaches the better habit: a new test cribs the import, not the setup.
 */

/**
 * Size the component's own box, NOT `document.body`: the canvas is absolutely
 * positioned and out of flow, so a body height leaves `.map2d` collapsed onto
 * its 12rem `min-height` and every test computes its fit from ~192px. Copy this
 * rule, not a body style. Svelte's scoped styles keep the authored class name,
 * so this plain selector matches, and the component sets `min-height` rather
 * than `height`, so there is no specificity fight. Appended for the lifetime of
 * the calling file: browser-mode gives each test file its own page, and the
 * selector names a class only this component uses.
 */
export function installMapSizing(): void {
  const sizing = document.createElement('style');
  sizing.textContent = '.map2d { width: 800px; height: 600px; }';
  document.head.append(sizing);
}

/** Wait for the ResizeObserver -> fit -> rAF draw chain to settle. */
export async function painted(canvas: HTMLCanvasElement): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) continue;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [r0, g0, b0, a0] = data;
    for (let p = 4; p < data.length; p += 4) {
      if (data[p] !== r0 || data[p + 1] !== g0 || data[p + 2] !== b0 || data[p + 3] !== a0) {
        return true;
      }
    }
  }
  return false;
}
