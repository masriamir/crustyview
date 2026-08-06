//! crustyview-core: native-portable WAD summarization and probing built on
//! crustywad, with no web/browser dependencies.
//!
//! `summary` and `probe` are the reusable, native-testable logic behind both
//! the wasm shim (`crustyview-web`) and the future native editor
//! (`crustyview-native`). See ADR-0002.

pub mod probe;
pub mod summary;
