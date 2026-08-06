//! crustyview-native: a portability-proving skeleton (ADR-0002).
//!
//! Loads a WAD from a path argument and prints its summary. Its only present
//! purpose is to keep `crustyview-core` honest — this crate depends on core and
//! must compile natively, so any accidental browser dependency in core breaks
//! the build here. It grows into the native editor later.

use std::process::ExitCode;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: crustyview-native <file.wad>");
        return ExitCode::FAILURE;
    };
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("read {path}: {err}");
            return ExitCode::FAILURE;
        }
    };
    match crustyview_core::summary::summarize(bytes) {
        Ok(summary) => {
            println!("{summary:#?}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("parse {path}: {err}");
            ExitCode::FAILURE
        }
    }
}
