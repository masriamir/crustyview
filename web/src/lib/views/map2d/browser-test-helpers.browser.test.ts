/**
 * The probe itself is load-bearing for nine browser files, so it gets its own
 * proof — in particular that a WebGL2-bound canvas is readable at all, which
 * the pre-#175 implementation silently failed (getContext('2d') on a GL-bound
 * canvas returns null, and the old loop read that as "never painted").
 */
import { describe, expect, it } from 'vitest';
import { painted } from './browser-test-helpers';

function sizedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.append(canvas);
  return canvas;
}

describe('painted', () => {
  it('sees ink on a 2D-bound canvas', async () => {
    const canvas = sizedCanvas();
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ff3b30';
    ctx.fillRect(8, 8, 16, 16);
    expect(await painted(canvas)).toBe(true);
  });

  it('reports a uniform 2D canvas as unpainted', async () => {
    const canvas = sizedCanvas();
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, 64, 64);
    expect(await painted(canvas)).toBe(false);
  });

  it('sees ink on a WebGL2-bound canvas', async () => {
    const canvas = sizedCanvas();
    // preserveDrawingBuffer keeps the pixels readable across the rAF ticks the
    // probe polls on; without it the buffer is cleared after compositing and a
    // later readPixels returns zeros. The GL renderer exposes the same option
    // for its test mounts (spec §2).
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })!;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 8, 8);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(await painted(canvas)).toBe(true);
  });

  it('never binds a context on an unsized canvas', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    document.body.append(canvas);
    expect(await painted(canvas)).toBe(false);
    // Proof painted() did not bind '2d': a webgl2 request still succeeds.
    expect(canvas.getContext('webgl2')).not.toBeNull();
  }, 15_000);
});
