# WASM go/no-go spike — result

- Date: 2026-08-04
- crustywad: 0.9.3 (crates.io)
- Verification method: headless Node (`--target nodejs` wasm-pack build) driving the
  same `analyze`/`first_texture_rgba` wasm-bindgen exports the browser page uses,
  against real IWADs on disk (never committed). The browser `--target web` build
  was also sanity-built; visual canvas confirmation is left to the user per the
  Step 3 checklist in `crates/crustyview/web/README.md`.

## WADs tested

- `DOOM.WAD` (retail IWAD, 12,408,292 bytes)
- `freedoom1.wad` (Freedoom IWAD, 28,795,076 bytes)

## Results

### DOOM.WAD

- summarize: PASS — `kind: "IWAD"`, `lump_count: 2306`, `map_count: 36`, `first_map: "E1M1"`
- map assembly (in-wasm): PASS — E1M1: 470 vertices, 486 linedefs, 666 sidedefs, 88 sectors, 143 things
- texture composite + palette (in-wasm): PASS — `AASTINKY`, 24×72, `rgba.length` 6912 == 24*72*4

### freedoom1.wad

- summarize: PASS — `kind: "IWAD"`, `lump_count: 3163`, `map_count: 36`, `first_map: "E1M1"`
- map assembly (in-wasm): PASS — E1M1: 1196 vertices, 1175 linedefs, 1829 sidedefs, 182 sectors, 292 things
- texture composite + palette (in-wasm): PASS — `AASTINKY`, 32×72, `rgba.length` 9216 == 32*72*4

Both WADs report `game: null` from `detect_game()` — expected, since that API is a
Strife-only content fingerprint (ADR-0028 §1) and neither fixture is Strife content.

Decision: **GO**
Follow-up: post-spike framework design (A: all-Rust wasm vs D: Rust-wasm core + TS UI).
Friction filed on crustywad: none (both API watch-items — `detect_game`, `map::Map` —
matched 0.9.3 exactly).
