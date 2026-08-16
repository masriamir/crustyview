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

/**
 * Wait for the ResizeObserver -> fit -> rAF draw chain to settle.
 *
 * Context-agnostic (#175): reads a 2D-bound canvas via getImageData and a
 * WebGL2-bound canvas via readPixels. The width gate runs BEFORE any
 * getContext call. It cannot fully prevent early binding: a fresh canvas is
 * 300×150 before anyone sizes it, and rAF polls can run before the
 * component's ResizeObserver fires. Harmless for the 2D path (re-requesting
 * '2d' returns the same context), but it means any WebGL-backed component
 * must create its context AT MOUNT — before the rAF phase — never inside
 * its first rAF draw, or this probe's early '2d' request would win the
 * canvas and force the fallback.
 *
 * Reading a WebGL2 canvas across frames additionally requires the context to
 * hold preserveDrawingBuffer: true — otherwise the buffer is cleared after
 * each composite and readPixels returns zeros. Test mounts opt into that via
 * the GL renderer's options; production keeps it off.
 */
export async function painted(canvas: HTMLCanvasElement): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if (canvas.width === 0) continue;
    const data = surfacePixels(canvas);
    if (!data) continue;
    const [r0, g0, b0, a0] = data;
    for (let p = 4; p < data.length; p += 4) {
      if (data[p] !== r0 || data[p + 1] !== g0 || data[p + 2] !== b0 || data[p + 3] !== a0) {
        return true;
      }
    }
  }
  return false;
}

/** The full RGBA surface of whichever context type the canvas is bound to. */
function surfacePixels(canvas: HTMLCanvasElement): Uint8ClampedArray | Uint8Array | null {
  const ctx = canvas.getContext('2d');
  if (ctx) return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const gl = canvas.getContext('webgl2');
  if (!gl) return null;
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
