//! crustyview-web: the wasm-bindgen shim over crustyview-core for the browser.
//!
//! Exposes one handle, [`WadDocument`], compiled only for `wasm32`. See ADR-0002.

#[cfg(target_arch = "wasm32")]
mod wad_document;
#[cfg(target_arch = "wasm32")]
pub use wad_document::WadDocument;
