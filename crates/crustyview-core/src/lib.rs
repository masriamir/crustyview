//! crustyview-core: native-portable WAD summarization and probing built on
//! crustywad, with no web/browser dependencies.
//!
//! `summary`, `probe`, and `error` are the reusable, native-testable logic
//! behind both the wasm shim (`crustyview-web`) and the future native editor
//! (`crustyview-native`). See ADR-0002.

pub mod error;
pub mod map2d;
pub mod probe;
pub mod summary;

#[cfg(test)]
pub(crate) mod fixtures;
