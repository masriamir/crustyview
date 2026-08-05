//! crustyview core: browser-facing WAD summarization built on crustywad.
//!
//! `summary` and `probe` are native-testable; the wasm-bindgen glue is compiled
//! only for the `wasm32` target.

pub mod probe;
pub mod summary;

#[cfg(target_arch = "wasm32")]
mod wasm;
