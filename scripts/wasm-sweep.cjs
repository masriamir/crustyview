// Headless wasm sweep: drives the real WadDocument handle
// (the --target nodejs build) over a WAD directory, and fails if any throws.
// Build the bundle first (from crates/crustyview-web):
//   wasm-pack build --target nodejs --out-dir web/pkg-node
// Usage: node scripts/wasm-sweep.cjs <wad-dir>   (or set CRUSTYVIEW_WAD_DIR)
const fs = require("fs");
const path = require("path");
const dir = process.argv[2] || process.env.CRUSTYVIEW_WAD_DIR;
if (!dir) {
  console.error("usage: node scripts/wasm-sweep.cjs <wad-dir> (or set CRUSTYVIEW_WAD_DIR)");
  process.exit(2);
}
const pkg = path.resolve(__dirname, "../crates/crustyview-web/web/pkg-node/crustyview_web.js");
let m;
try {
  m = require(pkg);
} catch (e) {
  console.error("missing nodejs bundle at " + pkg +
    "\nBuild it: (cd crates/crustyview-web && wasm-pack build --target nodejs --out-dir web/pkg-node)");
  process.exit(2);
}
let files;
try {
  files = fs.readdirSync(dir).filter((f) => /\.wad$/i.test(f)).sort();
} catch (e) {
  console.error("cannot read directory " + dir + ": " + e.message);
  process.exit(2);
}
if (files.length === 0) {
  console.error("no *.wad files in " + dir);
  process.exit(2);
}
const pad = (s, n) => (s + "").padEnd(n).slice(0, n);
console.log(pad("WAD", 24) + pad("kind", 6) + pad("maps", 5) + pad("game", 8) +
  pad("texture", 22) + pad("rgba", 8) + "opaque%");
let failures = 0;
for (const f of files) {
  let row = pad(f, 24);
  try {
    const raw = fs.readFileSync(path.join(dir, f));
    const buf = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    const doc = m.WadDocument.load(buf);
    try {
      const s = JSON.parse(doc.summary());
      const tex = JSON.parse(doc.textureMeta());
      row += pad(s.kind, 6) + pad(s.map_count, 5) + pad(s.game, 8);
      row += pad(tex ? tex.name + " " + tex.width + "x" + tex.height : "null", 22);
      const rgba = doc.textureRgba();
      let op = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 0) op++;
      const tot = rgba.length / 4;
      row += pad(rgba.length, 8) + (tot ? ((100 * op) / tot).toFixed(1) + "%" : "-");

      for (const name of doc.mapNames()) {
        const json = doc.map2d(name);
        try {
          JSON.parse(json);
        } catch (e) {
          throw new Error("map2d(" + name + ") returned unparseable JSON: " + e.message);
        }
        const statsJson = doc.mapStats(name);
        try {
          JSON.parse(statsJson);
        } catch (e) {
          throw new Error("mapStats(" + name + ") returned unparseable JSON: " + e.message);
        }
      }
    } finally {
      doc.free();
    }
  } catch (e) {
    failures++;
    row += "FAILED (load/summary/texture): " + e.message;
  }
  console.log(row);
}
console.log("\n" + (failures
  ? failures + " WAD(s) FAILED (WadDocument threw)"
  : "All " + files.length + " WAD(s) loaded without throwing."));
process.exit(failures ? 1 : 0);
