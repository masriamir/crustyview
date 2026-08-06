import init, { WadDocument } from "./pkg/crustyview_web.js";

await init();

document.getElementById("file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());

  let doc;
  try {
    doc = WadDocument.load(buf);
  } catch (err) {
    document.getElementById("out").textContent =
      "Error: " + (err && err.message ? err.message : err);
    return;
  }

  try {
    const report = {
      summary: JSON.parse(doc.summary()),
      maps: doc.mapNames(),
      texture: JSON.parse(doc.textureMeta()),
    };
    document.getElementById("out").textContent = JSON.stringify(report, null, 2);

    const tex = report.texture;
    const canvas = document.getElementById("tex");
    const resetCtx = canvas.getContext("2d");
    if (resetCtx) resetCtx.clearRect(0, 0, canvas.width, canvas.height);
    if (tex && tex.width > 0 && tex.height > 0) {
      const rgba = doc.textureRgba();
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
    }
  } finally {
    // Free the wasm-owned handle so repeated loads don't leak.
    doc.free();
  }
});
