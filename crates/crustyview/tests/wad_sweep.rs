//! Fixture-gated sweep over a local WAD collection.
//!
//! Set `CRUSTYVIEW_WAD_DIR` to an **absolute** path to a directory of `*.wad`
//! files (cargo runs tests with CWD = the package root, so a relative path will
//! not resolve). The test skips (passes) when the variable is unset — commercial
//! IWADs are never committed. `just sweep dir=/abs/path` runs it locally; CI runs
//! it against fetched Freedoom.
//!
//! It guards the read-path robustness the viewer depends on: every WAD loads and a
//! summary + map are obtainable for each, with the probes never panicking. A
//! texture-probe `Err` (e.g. Strife's sentinel negative patch counts) is allowed
//! and must not prevent obtaining the summary/map.

use crustyview::probe::{probe_first_map, probe_first_texture, probe_first_texture_meta};
use crustyview::summary::summarize_wad;
use crustywad::Wad;
use std::path::PathBuf;

#[test]
fn sweep_wad_collection() {
    let Ok(dir) = std::env::var("CRUSTYVIEW_WAD_DIR") else {
        eprintln!("CRUSTYVIEW_WAD_DIR not set — skipping WAD sweep.");
        return;
    };
    let dir = PathBuf::from(&dir);
    let mut wads: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read CRUSTYVIEW_WAD_DIR {dir:?}: {e}"))
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("wad")))
        .collect();
    wads.sort();
    assert!(!wads.is_empty(), "no *.wad files found in {dir:?}");

    eprintln!("Sweeping {} WAD(s) in {dir:?}", wads.len());
    for path in &wads {
        let name = path.file_name().unwrap().to_string_lossy();
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{name}: read failed: {e}"));

        let wad = Wad::from_bytes(bytes)
            .unwrap_or_else(|e| panic!("{name}: Wad::from_bytes failed: {e}"));

        // Summary + map are always obtainable, independent of the texture outcome.
        let summary = summarize_wad(&wad);
        assert!(!summary.kind.is_empty(), "{name}: empty kind");
        assert!(summary.lump_count > 0, "{name}: zero lumps");
        let map = probe_first_map(&wad); // Some/None both fine; must not panic.

        // Texture probes must not panic. An Err is allowed — the point is it never
        // prevents obtaining the summary/map above.
        let meta = probe_first_texture_meta(&wad);
        let full = probe_first_texture(&wad);

        let meta_s = match &meta {
            Ok(Some(m)) => format!("{}x{}", m.width, m.height),
            Ok(None) => "none".to_owned(),
            Err(e) => format!("err({e})"),
        };
        let full_s = match &full {
            Ok(Some(t)) => format!("{}px", t.rgba.len() / 4),
            Ok(None) => "none".to_owned(),
            Err(_) => "err".to_owned(),
        };
        eprintln!(
            "  {name:<24} kind={} lumps={} maps={} first={:?} game={:?} map={} meta={meta_s} full={full_s}",
            summary.kind,
            summary.lump_count,
            summary.map_count,
            summary.first_map,
            summary.game,
            if map.is_some() { "some" } else { "none" },
        );
    }
}
