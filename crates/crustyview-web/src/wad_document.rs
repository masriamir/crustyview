//! The `WadDocument` handle: parse a WAD once, then answer cheap queries.
//!
//! The parsed `Wad` stays in wasm memory; only small JSON strings and byte
//! buffers cross to JavaScript (the ADR-0002 boundary rule).

use crustyview_core::{probe, summary};
use crustywad::Wad;
use wasm_bindgen::prelude::*;

/// A parsed WAD held in wasm memory. Construct with [`WadDocument::load`].
#[wasm_bindgen]
pub struct WadDocument {
    wad: Wad,
}

#[wasm_bindgen]
impl WadDocument {
    /// Parse `bytes` as a WAD and hold it for subsequent queries.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` when `bytes` are not a valid WAD.
    pub fn load(bytes: Vec<u8>) -> Result<WadDocument, JsError> {
        let wad = Wad::from_bytes(bytes).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(WadDocument { wad })
    }

    /// A JSON [`WadSummary`](crustyview_core::summary::WadSummary).
    #[must_use]
    #[wasm_bindgen(js_name = summary)]
    pub fn summary(&self) -> String {
        let s = summary::summarize_wad(&self.wad);
        serde_json::to_string(&s).unwrap_or_else(|_| "null".to_owned())
    }

    /// The WAD's map-group names, in directory order.
    #[must_use]
    #[wasm_bindgen(js_name = mapNames)]
    pub fn map_names(&self) -> Vec<String> {
        self.wad.map_groups().into_iter().map(|g| g.name).collect()
    }

    /// JSON [`TextureMeta`](crustyview_core::probe::TextureMeta) for the first
    /// texture, or the string `"null"` when there is none (or parsing fails).
    #[must_use]
    #[wasm_bindgen(js_name = textureMeta)]
    pub fn texture_meta(&self) -> String {
        match probe::probe_first_texture_meta(&self.wad) {
            Ok(Some(meta)) => serde_json::to_string(&meta).unwrap_or_else(|_| "null".to_owned()),
            _ => "null".to_owned(),
        }
    }

    /// The first texture's composited RGBA pixels, or an empty buffer when
    /// there is no texture, no palette, or compositing fails.
    #[must_use]
    #[wasm_bindgen(js_name = textureRgba)]
    pub fn texture_rgba(&self) -> Vec<u8> {
        probe::probe_first_texture(&self.wad)
            .ok()
            .flatten()
            .map(|t| t.rgba)
            .unwrap_or_default()
    }
}
