//! wasm-bindgen tests for the `WadDocument` handle. Run: `wasm-pack test --node crates/crustyview-web`.
#![cfg(target_arch = "wasm32")]

use crustyview_web::WadDocument;
use wasm_bindgen_test::wasm_bindgen_test;

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
    assert!(WadDocument::load(b"not a wad".to_vec()).is_err());
}
