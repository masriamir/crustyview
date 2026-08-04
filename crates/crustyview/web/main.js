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
      canvas.width = tex.width;
      canvas.height = tex.height;
      const ctx = canvas.getContext("2d");
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(rgba), tex.width, tex.height),
        0,
        0,
      );
    }
  } catch (err) {
    document.getElementById("out").textContent =
      "Error: " + (err && err.message ? err.message : err);
  }
});
