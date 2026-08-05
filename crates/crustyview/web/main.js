import init, { analyze, first_texture_rgba } from "./pkg/crustyview.js";

await init();

document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  try {
    const report = JSON.parse(analyze(buf));
    document.getElementById("out").textContent = JSON.stringify(
      report,
      null,
      2,
    );

    const tex = report.texture;
    const canvas = document.getElementById("tex");
    // Reset the canvas each load so a WAD with no drawable texture doesn't
    // leave the previous WAD's image on screen.
    const resetCtx = canvas.getContext("2d");
    if (resetCtx) resetCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (tex && tex.width > 0 && tex.height > 0) {
      // Texture rendering is best-effort and isolated: first_texture_rgba can
      // throw (a wasm Err maps to a JS exception), so keep it out of the outer
      // try/catch — a compositing failure must only skip drawing, never replace
      // the already-rendered summary output.
      try {
        const rgba = first_texture_rgba(buf);
        // Texture dimensions come from the TextureDef, but the RGBA buffer is
        // empty when compositing can't run (e.g. textures present but no PLAYPAL).
        // Only draw when the buffer matches width*height*4; otherwise skip.
        if (rgba.length === tex.width * tex.height * 4) {
          canvas.width = tex.width;
          canvas.height = tex.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.putImageData(
              new ImageData(
                new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length),
                tex.width,
                tex.height,
              ),
              0,
              0,
            );
          }
        }
      } catch (texErr) {
        console.warn("texture render failed; summary preserved:", texErr);
      }
    }
  } catch (err) {
    document.getElementById("out").textContent =
      "Error: " + (err && err.message ? err.message : err);
  }
});
