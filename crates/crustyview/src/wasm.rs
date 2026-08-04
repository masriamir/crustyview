//! wasm-bindgen glue exposing summaries and probes to JavaScript.

use crustywad::Wad;
use wasm_bindgen::prelude::*;

/// Analyze a WAD's bytes and return a JSON string: `{ summary, map, texture }`.
///
/// `texture` carries name/width/height only; fetch pixels via
/// [`first_texture_rgba`].
///
/// # Errors
///
/// Returns a `JsError` if the bytes are not a valid WAD or a read path fails.
#[wasm_bindgen]
pub fn analyze(bytes: &[u8]) -> Result<String, JsError> {
    let summary = crate::summary::summarize(bytes.to_vec()).map_err(js)?;
    let wad = Wad::from_bytes(bytes.to_vec()).map_err(js)?;
    let map = crate::probe::probe_first_map(&wad);
    let texture = crate::probe::probe_first_texture(&wad).map_err(js)?;
    let report = serde_json::json!({
        "summary": summary,
        "map": map,
        "texture": texture,
    });
    Ok(report.to_string())
}

/// Return the first texture's RGBA pixels (empty when there is no texture).
///
/// # Errors
///
/// Returns a `JsError` if the bytes are not a valid WAD or compositing fails.
#[wasm_bindgen]
pub fn first_texture_rgba(bytes: &[u8]) -> Result<Vec<u8>, JsError> {
    let wad = Wad::from_bytes(bytes.to_vec()).map_err(js)?;
    Ok(crate::probe::probe_first_texture(&wad)
        .map_err(js)?
        .map(|t| t.rgba)
        .unwrap_or_default())
}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}
