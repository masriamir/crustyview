//! crustyview-web: the wasm-bindgen shim over crustyview-core for the browser.
//!
//! Exposes one handle, `WadDocument`, and the build's `version`, compiled only
//! for `wasm32` (so no intra-doc link — the items do not exist in native
//! rustdoc builds). See ADR-0002 and ADR-0004.

#[cfg(target_arch = "wasm32")]
mod wad_document;
#[cfg(target_arch = "wasm32")]
pub use wad_document::WadDocument;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

/// The crustyview build version — the workspace `version`, inherited by every
/// crate. The app renders this alongside a build-time git SHA (ADR-0004).
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
#[must_use]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
