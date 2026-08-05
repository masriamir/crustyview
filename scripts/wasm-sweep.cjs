// Headless wasm sweep: drives the real analyze()/first_texture_rgba() exports
// (the --target nodejs build) over a WAD directory, and fails if any throws.
// Build the bundle first (from crates/crustyview):
//   wasm-pack build --target nodejs --out-dir web/pkg-node
// Usage: node scripts/wasm-sweep.cjs <wad-dir>   (or set CRUSTYVIEW_WAD_DIR)
const fs = require("fs");
const path = require("path");
const dir = process.argv[2] || process.env.CRUSTYVIEW_WAD_DIR;
if (!dir) {
  console.error("usage: node scripts/wasm-sweep.cjs <wad-dir> (or set CRUSTYVIEW_WAD_DIR)");
  process.exit(2);
}
const pkg = path.resolve(__dirname, "../crates/crustyview/web/pkg-node/crustyview.js");
let m;
try {
  m = require(pkg);
} catch (e) {
  console.error("missing nodejs bundle at " + pkg +
    "\nBuild it: (cd crates/crustyview && wasm-pack build --target nodejs --out-dir web/pkg-node)");
  process.exit(2);
}
const files = fs.readdirSync(dir).filter((f) => /\.wad$/i.test(f)).sort();
if (files.length === 0) {
  console.error("no *.wad files in " + dir);
  process.exit(2);
}
const pad = (s, n) => (s + "").padEnd(n).slice(0, n);
console.log(pad("WAD", 24) + pad("kind", 6) + pad("maps", 5) + pad("game", 8) +
  pad("texture", 22) + pad("rgba", 8) + "opaque%");
let failures = 0;
for (const f of files) {
  const buf = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  let row = pad(f, 24);
  try {
    const rep = JSON.parse(m.analyze(buf));
    const s = rep.summary;
    row += pad(s.kind, 6) + pad(s.map_count, 5) + pad(s.game, 8);
    row += pad(rep.texture ? rep.texture.name + " " + rep.texture.width + "x" + rep.texture.height : "null", 22);
    try {
      const rgba = m.first_texture_rgba(buf);
      let op = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) op++;
      const tot = rgba.length / 4;
      row += pad(rgba.length, 8) + (tot ? (100 * op / tot).toFixed(1) + "%" : "-");
    } catch (e) {
      failures++;
      row += "first_texture_rgba THREW: " + e.message;
    }
  } catch (e) {
    failures++;
    row += "analyze THREW: " + e.message;
  }
  console.log(row);
}
console.log("\n" + (failures
  ? failures + " WAD(s) FAILED (analyze/first_texture_rgba threw)"
  : "All " + files.length + " WAD(s) loaded without throwing."));
process.exit(failures ? 1 : 0);
