//! The `WadDocument` handle: parse a WAD once, then answer cheap queries.
//!
//! The parsed `Wad` stays in wasm memory; only small JSON strings and byte
//! buffers cross to JavaScript (the ADR-0002 boundary rule).

use crustyview_core::{error, map2d, probe, summary};
use crustywad::Wad;
use crustywad::gfx::TextureSet;
use std::cell::OnceCell;
use wasm_bindgen::prelude::*;

/// A parsed WAD held in wasm memory. Construct with [`WadDocument::load`].
#[wasm_bindgen]
pub struct WadDocument {
    wad: Wad,
    /// Parsed on first texture query and reused. `Wad::texture_set` re-parses
    /// TEXTURE1/TEXTURE2 + PNAMES on every call — ~73 ms on a 125 MB WAD — and
    /// both texture entry points need it, so it was previously paid twice (#57).
    /// `OnceCell`, not `LazyLock`: wasm32 is single-threaded and this handle is
    /// neither `Send` nor `Sync`.
    texture_set: OnceCell<Option<TextureSet>>,
}

#[wasm_bindgen]
impl WadDocument {
    /// Parse `bytes` as a WAD and hold it for subsequent queries.
    ///
    /// # Errors
    ///
    /// Returns a `JsError` when `bytes` are not a valid WAD.
    pub fn load(bytes: Vec<u8>) -> Result<WadDocument, JsError> {
        let wad =
            Wad::from_bytes(bytes).map_err(|e| JsError::new(&error::load_error_message(&e)))?;
        Ok(WadDocument {
            wad,
            texture_set: OnceCell::new(),
        })
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

    /// JSON [`Map2d`](crustyview_core::map2d::Map2d) for the named map, or a
    /// `{"error":"<message>"}` envelope when the map is missing or fails to
    /// assemble (#46) — the message is user-facing and single-line.
    #[must_use]
    #[wasm_bindgen(js_name = map2d)]
    pub fn map2d(&self, name: &str) -> String {
        match map2d::map2d(&self.wad, name) {
            Ok(m) => serde_json::to_string(&m)
                .unwrap_or_else(|_| error_envelope("could not serialize map data")),
            Err(msg) => error_envelope(&msg),
        }
    }

    /// JSON [`MapStats`](crustyview_core::probe::MapStats) for the named map,
    /// or the string `"null"` when the map is missing or fails to assemble
    /// (best-effort, like `textureMeta` — not `map2d`'s error envelope).
    #[must_use]
    #[wasm_bindgen(js_name = mapStats)]
    pub fn map_stats(&self, name: &str) -> String {
        match probe::map_stats(&self.wad, name) {
            Some(stats) => serde_json::to_string(&stats).unwrap_or_else(|_| "null".to_owned()),
            None => "null".to_owned(),
        }
    }

    /// JSON [`TextureMeta`](crustyview_core::probe::TextureMeta) for the first
    /// texture, or the string `"null"` when there is none (or parsing fails).
    #[must_use]
    #[wasm_bindgen(js_name = textureMeta)]
    pub fn texture_meta(&self) -> String {
        match self
            .cached_texture_set()
            .and_then(probe::texture_meta_from_set)
        {
            Some(meta) => serde_json::to_string(&meta).unwrap_or_else(|_| "null".to_owned()),
            None => "null".to_owned(),
        }
    }

    /// The first texture's composited RGBA pixels, or an empty buffer when
    /// there is no texture, no palette, or compositing fails.
    #[must_use]
    #[wasm_bindgen(js_name = textureRgba)]
    pub fn texture_rgba(&self) -> Vec<u8> {
        let Some(set) = self.cached_texture_set() else {
            return Vec::new();
        };
        let Ok(Some(playpal)) = self.wad.playpal() else {
            return Vec::new();
        };
        let Some(palette) = playpal.palettes().first() else {
            return Vec::new();
        };
        probe::first_texture_from_set(set, palette)
            .ok()
            .flatten()
            .map(|t| t.rgba)
            .unwrap_or_default()
    }
}

impl WadDocument {
    /// The parsed texture set, computed once.
    ///
    /// A parse error caches as `None`, which is exactly what both texture entry
    /// points already reported for a failure — so memoizing cannot change what
    /// JavaScript sees.
    fn cached_texture_set(&self) -> Option<&TextureSet> {
        self.texture_set
            .get_or_init(|| self.wad.texture_set().ok().flatten())
            .as_ref()
    }
}

/// The failure shape [`WadDocument::map2d`] returns: `{"error":"<msg>"}`,
/// JSON-escaped.
fn error_envelope(msg: &str) -> String {
    serde_json::json!({ "error": msg }).to_string()
}
