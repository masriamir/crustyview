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
/// Returns a `JsError` only if the bytes are not a valid WAD. Map-assembly and
/// texture-set parse failures are not errors: they are reported as `map: null`
/// / `texture: null` in the JSON, matching the probes' swallow-to-`None`
/// behavior — so e.g. a Strife WAD whose `TEXTURE1` uses sentinel negative patch
/// counts still returns its summary and map.
#[wasm_bindgen]
pub fn analyze(bytes: Vec<u8>) -> Result<String, JsError> {
    let wad = Wad::from_bytes(bytes).map_err(js)?;
    let summary = crustyview_core::summary::summarize_wad(&wad);
    let map = crustyview_core::probe::probe_first_map(&wad);
    // Best-effort, like the map probe: a texture-set parse error must not abort
    // the whole analysis — report `texture: null` and still return summary + map.
    let texture = crustyview_core::probe::probe_first_texture_meta(&wad).unwrap_or(None);
    let report = serde_json::json!({
        "summary": summary,
        "map": map,
        "texture": texture,
    });
    Ok(report.to_string())
}

/// Return the first texture's RGBA pixels, or an empty buffer when there is no
/// texture set, no textures, no `PLAYPAL` to composite against, or when parsing
/// or compositing fails. An empty buffer therefore does not necessarily mean
/// "no textures" — callers must not conflate the two.
///
/// # Errors
///
/// Returns a `JsError` only if the bytes are not a valid WAD. A texture-set or
/// compositing failure yields an empty buffer, not an error (mirroring
/// [`analyze`]'s best-effort texture handling).
#[wasm_bindgen]
pub fn first_texture_rgba(bytes: Vec<u8>) -> Result<Vec<u8>, JsError> {
    let wad = Wad::from_bytes(bytes).map_err(js)?;
    Ok(crustyview_core::probe::probe_first_texture(&wad)
        .ok()
        .flatten()
        .map(|t| t.rgba)
        .unwrap_or_default())
}

fn js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}
