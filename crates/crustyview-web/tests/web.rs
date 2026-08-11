//! wasm-bindgen tests for the `WadDocument` handle. Run: `wasm-pack test --node crates/crustyview-web`.
#![cfg(target_arch = "wasm32")]

use crustyview_web::WadDocument;
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
