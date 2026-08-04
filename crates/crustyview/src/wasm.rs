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
/// Returns a `JsError` if the bytes are not a valid WAD or texture-set
/// parsing fails. Map-assembly failures are not an error: they are
/// reported as `map: null` in the JSON, matching
/// [`probe_first_map`](crate::probe::probe_first_map)'s swallow-to-`None`
/// behavior.
#[wasm_bindgen]
pub fn analyze(bytes: Vec<u8>) -> Result<String, JsError> {
    let wad = Wad::from_bytes(bytes).map_err(js)?;
    let summary = crate::summary::summarize_wad(&wad);
    let map = crate::probe::probe_first_map(&wad);
    let texture = crate::probe::probe_first_texture_meta(&wad).map_err(js)?;
    let report = serde_json::json!({
        "summary": summary,
        "map": map,
        "texture": texture,
    });
    Ok(report.to_string())
}

/// Return the first texture's RGBA pixels, or an empty buffer when there is no
/// texture set, no textures, or no `PLAYPAL` to composite against. An empty
/// buffer therefore does not necessarily mean "no textures" — callers must not
/// conflate the two.
///
/// # Errors
///
/// Returns a `JsError` if the bytes are not a valid WAD, or if parsing the
/// texture set or compositing the pixels fails.
#[wasm_bindgen]
pub fn first_texture_rgba(bytes: Vec<u8>) -> Result<Vec<u8>, JsError> {
    let wad = Wad::from_bytes(bytes).map_err(js)?;
    Ok(crate::probe::probe_first_texture(&wad)
        .map_err(js)?
        .map(|t| t.rgba)
        .unwrap_or_default())
}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}
