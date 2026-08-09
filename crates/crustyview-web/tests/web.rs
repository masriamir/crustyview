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
    // Guard the shape too: a bare `env!` typo that yielded an empty string
    // would still satisfy the equality above at build time.
    assert!(
        v.split('.').count() == 3,
        "expected MAJOR.MINOR.PATCH, got {v}"
    );
}
