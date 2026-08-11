//! wasm-bindgen tests for the `WadDocument` handle. Run: `wasm-pack test --node crates/crustyview-web`.
#![cfg(target_arch = "wasm32")]

use crustyview_web::WadDocument;
use crustywad::Wad;
use crustywad::gfx::GfxError;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::wasm_bindgen_test;

/// The `message` of the `Error` a failed [`WadDocument::load`] throws.
fn load_error_message(bytes: &[u8]) -> String {
    let Err(err) = WadDocument::load(bytes.to_vec()) else {
        panic!("load must fail")
    };
    let js: wasm_bindgen::JsValue = err.into();
    let error: js_sys::Error = js.dyn_into().expect("a JS Error");
    String::from(error.message())
}

/// A 12-byte empty PWAD: magic `PWAD`, `numlumps = 0`, `infotableofs = 12`.
fn empty_pwad() -> Vec<u8> {
    let mut v = b"PWAD".to_vec();
    v.extend_from_slice(&0i32.to_le_bytes()); // numlumps
    v.extend_from_slice(&12i32.to_le_bytes()); // infotableofs
    v
}

#[wasm_bindgen_test]
fn loads_and_summarizes_empty_pwad() {
    let doc = WadDocument::load(empty_pwad()).expect("valid WAD");
    let summary = doc.summary();
    assert!(
        summary.contains("\"kind\":\"PWAD\""),
        "summary was {summary}"
    );
    assert!(
        summary.contains("\"lump_count\":0"),
        "summary was {summary}"
    );
    assert!(doc.map_names().is_empty());
    assert_eq!(doc.texture_meta(), "null");
    assert!(doc.texture_rgba().is_empty());
}

#[wasm_bindgen_test]
fn rejects_non_wad_bytes() {
    assert!(WadDocument::load(b"NOPE12345678".to_vec()).is_err());
    assert!(load_error_message(b"NOPE12345678").contains("invalid WAD magic"));
}

#[wasm_bindgen_test]
fn sub_header_bytes_reject_with_clean_message() {
    let message = load_error_message(b"tiny");
    assert_eq!(
        message,
        "failed to parse WAD header: unexpected end of input"
    );
}

#[wasm_bindgen_test]
fn map2d_of_missing_map_reports_the_error() {
    let doc = WadDocument::load(empty_pwad()).expect("valid WAD");
    assert_eq!(doc.map2d("MAP01"), r#"{"error":"no map named MAP01"}"#);
}

#[wasm_bindgen_test]
fn map_stats_of_missing_map_is_null() {
    let doc = WadDocument::load(empty_pwad()).expect("valid WAD");
    assert_eq!(doc.map_stats("MAP01"), "null");
}

#[wasm_bindgen_test]
fn version_is_the_crate_version() {
    let v = crustyview_web::version();
    assert_eq!(v, env!("CARGO_PKG_VERSION"));
    // Pin the shape the UI depends on: `formatBuild` and the E2E regex both
    // assume MAJOR.MINOR.PATCH. (This is not a guard against a typo'd `env!` —
    // a missing environment variable fails compilation rather than yielding an
    // empty string.)
    assert!(
        v.split('.').count() == 3,
        "expected MAJOR.MINOR.PATCH, got {v}"
    );
}

/// A PWAD carrying `lumps` in order, with the directory written last.
fn build_wad(lumps: &[(&str, Vec<u8>)]) -> Vec<u8> {
    const HEADER: usize = 12;
    let data_len: usize = lumps.iter().map(|(_, b)| b.len()).sum();
    let mut out = b"PWAD".to_vec();
    out.extend_from_slice(&i32::try_from(lumps.len()).unwrap().to_le_bytes());
    out.extend_from_slice(&i32::try_from(HEADER + data_len).unwrap().to_le_bytes());
    for (_, bytes) in lumps {
        out.extend_from_slice(bytes);
    }
    let mut pos = HEADER;
    for (name, bytes) in lumps {
        out.extend_from_slice(&i32::try_from(pos).unwrap().to_le_bytes());
        out.extend_from_slice(&i32::try_from(bytes.len()).unwrap().to_le_bytes());
        let mut name8 = [0u8; 8];
        name8[..name.len()].copy_from_slice(name.as_bytes());
        out.extend_from_slice(&name8);
        pos += bytes.len();
    }
    out
}

/// A PWAD with one 8x8, zero-patch texture `TEX1` and an empty `PNAMES`.
fn texture1_pwad() -> Vec<u8> {
    let mut texture1 = Vec::new();
    texture1.extend_from_slice(&1i32.to_le_bytes()); // numtextures
    texture1.extend_from_slice(&8i32.to_le_bytes()); // offset to the one entry
    texture1.extend_from_slice(b"TEX1\0\0\0\0"); // name, 8 bytes
    texture1.extend_from_slice(&0i32.to_le_bytes()); // masked (dead field)
    texture1.extend_from_slice(&8i16.to_le_bytes()); // width
    texture1.extend_from_slice(&8i16.to_le_bytes()); // height
    texture1.extend_from_slice(&0i32.to_le_bytes()); // column_directory (dead)
    texture1.extend_from_slice(&0i16.to_le_bytes()); // patchcount
    let pnames = 0i32.to_le_bytes().to_vec(); // numpatches = 0
    build_wad(&[("TEXTURE1", texture1), ("PNAMES", pnames)])
}

#[wasm_bindgen_test]
fn texture_queries_are_stable_across_repeated_calls() {
    // The memoized texture set must be invisible from the outside: repeated
    // calls answer identically, and interleaving the two entry points (which
    // share the cache) changes nothing.
    let doc = WadDocument::load(texture1_pwad()).expect("valid WAD");

    let first = doc.texture_meta();
    assert!(first.contains("\"name\":\"TEX1\""), "meta was {first}");
    assert!(first.contains("\"width\":8"), "meta was {first}");

    // No PLAYPAL, so compositing yields nothing — but it must not disturb the
    // cached set that `texture_meta` reads.
    assert!(doc.texture_rgba().is_empty());
    assert_eq!(
        doc.texture_meta(),
        first,
        "cache must not change the answer"
    );
}

#[wasm_bindgen_test]
fn texture_queries_stay_null_across_repeated_calls_without_a_texture_set() {
    let doc = WadDocument::load(empty_pwad()).expect("valid WAD");
    assert_eq!(doc.texture_meta(), "null");
    assert_eq!(doc.texture_meta(), "null");
    assert!(doc.texture_rgba().is_empty());
    assert!(doc.texture_rgba().is_empty());
}

/// A PWAD whose `TEXTURE1` lump parses successfully but defines zero
/// textures (`numtextures = 0`), with an empty `PNAMES`. Unlike
/// [`empty_pwad`] (no `TEXTURE1` lump at all, so `wad.texture_set()` is
/// `Ok(None)`), this fixture makes `wad.texture_set()` return
/// `Ok(Some(set))` with `set.textures().is_empty()` — a different branch
/// through `cached_texture_set`'s callers.
fn texture1_zero_textures_pwad() -> Vec<u8> {
    let texture1 = 0i32.to_le_bytes().to_vec(); // numtextures = 0
    let pnames = 0i32.to_le_bytes().to_vec(); // numpatches = 0
    build_wad(&[("TEXTURE1", texture1), ("PNAMES", pnames)])
}

#[wasm_bindgen_test]
fn texture_queries_stay_null_when_the_texture_set_has_no_textures() {
    let bytes = texture1_zero_textures_pwad();

    // Confirm the fixture actually produces a present-but-empty set before
    // relying on it: a `TEXTURE1` lump that failed to parse at all would
    // exercise the same "null" outcome for the wrong reason.
    let wad = Wad::from_bytes(bytes.clone()).expect("valid WAD");
    let set = wad
        .texture_set()
        .expect("texture set should parse")
        .expect("TEXTURE1 lump is present");
    assert!(
        set.textures().is_empty(),
        "test fixture should have zero texture definitions"
    );

    let doc = WadDocument::load(bytes).expect("valid WAD");
    assert_eq!(doc.texture_meta(), "null");
    assert_eq!(doc.texture_meta(), "null");
    assert!(doc.texture_rgba().is_empty());
    assert!(doc.texture_rgba().is_empty());
}

/// [`texture1_pwad`]'s `TEXTURE1`/`PNAMES` shape, plus a `PLAYPAL` lump
/// whose length (7 bytes) is not a positive multiple of 768 — `Wad::playpal`
/// parses strictly and fails on it with `GfxError::PlaypalSize`.
fn texture1_with_malformed_playpal_pwad() -> Vec<u8> {
    let mut texture1 = Vec::new();
    texture1.extend_from_slice(&1i32.to_le_bytes()); // numtextures
    texture1.extend_from_slice(&8i32.to_le_bytes()); // offset to the one entry
    texture1.extend_from_slice(b"TEX1\0\0\0\0"); // name, 8 bytes
    texture1.extend_from_slice(&0i32.to_le_bytes()); // masked (dead field)
    texture1.extend_from_slice(&8i16.to_le_bytes()); // width
    texture1.extend_from_slice(&8i16.to_le_bytes()); // height
    texture1.extend_from_slice(&0i32.to_le_bytes()); // column_directory (dead)
    texture1.extend_from_slice(&0i16.to_le_bytes()); // patchcount
    let pnames = 0i32.to_le_bytes().to_vec(); // numpatches = 0
    let malformed_playpal = vec![0u8; 7]; // not a positive multiple of 768
    build_wad(&[
        ("TEXTURE1", texture1),
        ("PNAMES", pnames),
        ("PLAYPAL", malformed_playpal),
    ])
}

#[wasm_bindgen_test]
fn texture_meta_survives_a_malformed_playpal_that_empties_texture_rgba() {
    let bytes = texture1_with_malformed_playpal_pwad();

    // Confirm the fixture's PLAYPAL is actually malformed before relying on
    // it — a test that passes because the lump parses fine protects nothing.
    let wad = Wad::from_bytes(bytes.clone()).expect("valid WAD");
    assert!(
        matches!(wad.playpal(), Err(GfxError::PlaypalSize { .. })),
        "test fixture's PLAYPAL lump should fail to parse"
    );

    let doc = WadDocument::load(bytes).expect("valid WAD");
    let meta = doc.texture_meta();
    assert!(meta.contains("\"name\":\"TEX1\""), "meta was {meta}");

    // The malformed palette empties `texture_rgba`, but it must not disturb
    // the shared cache: `texture_meta` still answers from the same set.
    assert!(doc.texture_rgba().is_empty());
    assert_eq!(doc.texture_meta(), meta, "cache must not change the answer");
}

/// A `TEXTURE1` lump that declares one texture (`numtextures = 1`) but is
/// too short to hold its offset table entry (needs 8 bytes, has 4) —
/// `wad.texture_set()` returns `Err(GfxError::TruncatedTextureX)` in strict
/// mode.
fn texture1_parse_failure_pwad() -> Vec<u8> {
    let texture1 = 1i32.to_le_bytes().to_vec(); // numtextures = 1, offset table omitted
    build_wad(&[("TEXTURE1", texture1)])
}

#[wasm_bindgen_test]
fn texture_queries_stay_null_when_the_texture_set_fails_to_parse() {
    let bytes = texture1_parse_failure_pwad();

    // Confirm the fixture really fails to parse before relying on it.
    let wad = Wad::from_bytes(bytes.clone()).expect("valid WAD");
    assert!(
        matches!(wad.texture_set(), Err(GfxError::TruncatedTextureX { .. })),
        "test fixture's TEXTURE1 lump should fail to parse"
    );

    // This is the path where `OnceCell::get_or_init` caches the parse error
    // as `None`, per `cached_texture_set`'s doc comment.
    let doc = WadDocument::load(bytes).expect("valid WAD");
    assert_eq!(doc.texture_meta(), "null");
    assert_eq!(doc.texture_meta(), "null");
    assert!(doc.texture_rgba().is_empty());
    assert!(doc.texture_rgba().is_empty());
}

/// A `PNAMES` lump listing `names` (each truncated/padded to 8 bytes).
fn build_pnames(names: &[&str]) -> Vec<u8> {
    let mut out = Vec::new();
    let count = i32::try_from(names.len()).unwrap();
    out.extend_from_slice(&count.to_le_bytes());
    for name in names {
        let mut padded = [0u8; 8];
        let nb = name.as_bytes();
        assert!(nb.len() <= 8, "patch name {name:?} exceeds 8 bytes");
        padded[..nb.len()].copy_from_slice(nb);
        out.extend_from_slice(&padded);
    }
    out
}

/// A `PLAYPAL` lump holding a single all-zero 256-entry RGB palette (768
/// bytes) — a valid palette for compositing purposes.
fn build_playpal_zero() -> Vec<u8> {
    vec![0u8; 768]
}

/// A `TEXTURE1` lump with a single texture definition named `name`
/// (truncated/padded to 8 bytes), given `width`/`height`, referencing one
/// full-canvas patch at `PNAMES` index `patch_index`, placed at `(0, 0)`.
///
/// A texture with a live patch spanning every column avoids
/// `TextureSet::compose`'s Medusa check (every column must have at least
/// one contributing patch in strict mode), unlike a zero-patch texture.
fn build_texture1_with_patch(name: &str, width: i16, height: i16, patch_index: i16) -> Vec<u8> {
    let mut name8 = [0u8; 8];
    let nb = name.as_bytes();
    assert!(nb.len() <= 8, "texture name {name:?} exceeds 8 bytes");
    name8[..nb.len()].copy_from_slice(nb);

    let mut out = Vec::new();
    out.extend_from_slice(&1i32.to_le_bytes()); // numtextures
    out.extend_from_slice(&8i32.to_le_bytes()); // offset: 4 (count) + 4 (one offset entry)
    out.extend_from_slice(&name8);
    out.extend_from_slice(&0i32.to_le_bytes()); // masked (dead field)
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // column_directory (dead field)
    out.extend_from_slice(&1i16.to_le_bytes()); // patchcount
    out.extend_from_slice(&0i16.to_le_bytes()); // origin_x
    out.extend_from_slice(&0i16.to_le_bytes()); // origin_y
    out.extend_from_slice(&patch_index.to_le_bytes());
    out.extend_from_slice(&0i16.to_le_bytes()); // step_dir (dead field)
    out.extend_from_slice(&0i16.to_le_bytes()); // colormap (dead field)
    out
}

/// A picture lump (a `PNAMES`-referenced patch) that is fully opaque: every
/// column has a single post spanning the whole height, filled with `pixel`.
/// Layout (crustywad's `Picture::parse`): 4 `i16` header fields (width,
/// height, left offset, top offset), then `width × i32` column offsets
/// (from the lump start), then each column's post chain — `top_delta: u8`,
/// `length: u8`, pad, `length` pixel bytes, pad, terminated by `0xFF`.
fn build_patch_full(width: i16, height: i16, pixel: u8) -> Vec<u8> {
    let w = usize::try_from(width).unwrap();
    let h = usize::try_from(height).unwrap();

    let mut out = Vec::new();
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0i16.to_le_bytes()); // left_offset
    out.extend_from_slice(&0i16.to_le_bytes()); // top_offset

    let table_start = out.len();
    out.resize(table_start + w * 4, 0);

    let mut offsets = Vec::with_capacity(w);
    for _ in 0..w {
        offsets.push(i32::try_from(out.len()).unwrap());
        out.push(0); // top_delta
        out.push(u8::try_from(h).unwrap()); // length
        out.push(0); // pad
        out.extend(std::iter::repeat_n(pixel, h));
        out.push(0); // pad
        out.push(0xFF); // terminator: no further posts
    }
    for (i, off) in offsets.into_iter().enumerate() {
        let at = table_start + i * 4;
        out[at..at + 4].copy_from_slice(&off.to_le_bytes());
    }
    out
}

/// A PWAD with one 8x8 texture `TEX1` composed from a single full-canvas
/// patch, plus a valid `PLAYPAL` — exercises the successful compositing
/// path end-to-end, through the shared cache.
fn texture1_with_patch_and_playpal_pwad() -> Vec<u8> {
    let texture1 = build_texture1_with_patch("TEX1", 8, 8, 0);
    let pnames = build_pnames(&["PAT1"]);
    let patch = build_patch_full(8, 8, 1);
    let playpal = build_playpal_zero();
    build_wad(&[
        ("TEXTURE1", texture1),
        ("PNAMES", pnames),
        ("PAT1", patch),
        ("PLAYPAL", playpal),
    ])
}

#[wasm_bindgen_test]
fn texture_rgba_composites_the_real_patch_through_the_cache() {
    let doc = WadDocument::load(texture1_with_patch_and_playpal_pwad()).expect("valid WAD");

    let meta = doc.texture_meta();
    assert!(meta.contains("\"name\":\"TEX1\""), "meta was {meta}");
    assert!(meta.contains("\"width\":8"), "meta was {meta}");
    assert!(meta.contains("\"height\":8"), "meta was {meta}");

    let rgba = doc.texture_rgba();
    assert_eq!(rgba.len(), 8 * 8 * 4, "expected width * height * 4 bytes");
}
