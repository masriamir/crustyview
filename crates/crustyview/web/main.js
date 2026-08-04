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
    if (tex && tex.width > 0 && tex.height > 0) {
      const rgba = first_texture_rgba(buf);
      // Texture dimensions come from the TextureDef, but the RGBA buffer is
      // empty when compositing can't run (e.g. textures present but no PLAYPAL).
      // Only draw when the buffer matches width*height*4; otherwise skip the
      // canvas so a length mismatch can't throw and clobber the summary output.
      if (rgba.length === tex.width * tex.height * 4) {
        canvas.width = tex.width;
        canvas.height = tex.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.putImageData(
            new ImageData(new Uint8ClampedArray(rgba), tex.width, tex.height),
            0,
            0,
          );
        }
      }
    }
  } catch (err) {
    document.getElementById("out").textContent =
      "Error: " + (err && err.message ? err.message : err);
  }
});
