//! Integration tests for [`crustyview_core::summary::summarize`].

mod common;

use common::build_wad;
use crustyview_core::summary::{summarize, summarize_wad};
use crustywad::Wad;

#[test]
fn summarizes_empty_pwad() {
    let s = summarize(build_wad(*b"PWAD", &[])).unwrap();
    assert_eq!(s.kind, "PWAD");
    assert_eq!(s.lump_count, 0);
    assert_eq!(s.map_count, 0);
    assert_eq!(s.first_map, None);
}

#[test]
fn counts_lumps_and_detects_a_map() {
    let s = summarize(build_wad(
        *b"IWAD",
        &[
            ("E1M1", b""),
            ("THINGS", b""),
            ("LINEDEFS", b""),
            ("SIDEDEFS", b""),
            ("VERTEXES", b""),
            ("SECTORS", b""),
        ],
    ))
    .unwrap();
    assert_eq!(s.kind, "IWAD");
    assert_eq!(s.lump_count, 6);
    assert_eq!(s.map_count, 1);
    assert_eq!(s.first_map.as_deref(), Some("E1M1"));
}

#[test]
fn rejects_non_wad_bytes() {
    assert!(summarize(b"not a wad at all".to_vec()).is_err());
}

#[test]
fn summarize_wad_matches_byte_path_on_already_parsed_wad() {
    let bytes = build_wad(
        *b"IWAD",
        &[
            ("E1M1", b""),
            ("THINGS", b""),
            ("LINEDEFS", b""),
            ("SIDEDEFS", b""),
            ("VERTEXES", b""),
            ("SECTORS", b""),
        ],
    );
    let wad = Wad::from_bytes(bytes).unwrap();
    let s = summarize_wad(&wad);
    assert_eq!(s.kind, "IWAD");
    assert_eq!(s.lump_count, 6);
    assert_eq!(s.map_count, 1);
    assert_eq!(s.first_map.as_deref(), Some("E1M1"));
}
