//! Integration tests for [`crustyview::probe::probe_first_map`] and
//! [`crustyview::probe::probe_first_texture`].

mod common;

use common::build_wad;
use crustyview::probe::{probe_first_map, probe_first_texture, probe_first_texture_meta};
use crustywad::Wad;

fn empty_pwad() -> Wad {
    // 12-byte header, 0 lumps, directory offset = 12.
    let mut b = Vec::new();
    b.extend_from_slice(b"PWAD");
    b.extend_from_slice(&0i32.to_le_bytes());
    b.extend_from_slice(&12i32.to_le_bytes());
    Wad::from_bytes(b).unwrap()
}

#[test]
fn no_map_group_probes_to_none() {
    assert!(probe_first_map(&empty_pwad()).is_none());
}

#[test]
fn no_textures_probes_to_none() {
    assert!(probe_first_texture(&empty_pwad()).unwrap().is_none());
}

#[test]
fn no_textures_probes_meta_to_none() {
    assert!(probe_first_texture_meta(&empty_pwad()).unwrap().is_none());
}

#[test]
fn probe_first_map_returns_assembled_counts() {
    // Two vertices: (0, 0) and (64, 64), each a pair of i16 LE coordinates.
    let vertexes: &[u8] = &[
        0x00, 0x00, // x = 0
        0x00, 0x00, // y = 0
        0x40, 0x00, // x = 64
        0x40, 0x00, // y = 64
    ];
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[
            ("E1M1", b""),
            ("THINGS", b""),
            ("LINEDEFS", b""),
            ("SIDEDEFS", b""),
            ("VERTEXES", vertexes),
            ("SECTORS", b""),
        ],
    ))
    .unwrap();

    let probe = probe_first_map(&wad).expect("map group should assemble");
    assert_eq!(probe.name, "E1M1");
    assert_eq!(probe.vertices, 2);
}

#[test]
fn probe_first_texture_meta_reads_first_texture() {
    let texture1 = common::build_texture1("TEX1", 8, 8);
    let pnames = common::build_pnames_empty();
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[("TEXTURE1", &texture1), ("PNAMES", &pnames)],
    ))
    .unwrap();

    let meta = probe_first_texture_meta(&wad)
        .unwrap()
        .expect("texture meta should be present");
    assert_eq!(meta.name, "TEX1");
    assert_eq!(meta.width, 8);
    assert_eq!(meta.height, 8);
}

#[test]
fn probe_first_texture_composites_blank() {
    // A single full-canvas patch keeps compositing trivial while still
    // satisfying the strict-mode Medusa check (every column must have a
    // contributing patch), unlike a zero-patch texture.
    let texture1 = common::build_texture1_with_patch("TEX1", 8, 8, 0);
    let pnames = common::build_pnames(&["PAT1"]);
    let patch = common::build_patch_full(8, 8, 1);
    let playpal = common::build_playpal_zero();
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[
            ("TEXTURE1", &texture1),
            ("PNAMES", &pnames),
            ("PAT1", &patch),
            ("PLAYPAL", &playpal),
        ],
    ))
    .unwrap();

    let probe = probe_first_texture(&wad)
        .unwrap()
        .expect("texture probe should be present");
    assert_eq!(probe.name, "TEX1");
    assert_eq!(probe.width, 8);
    assert_eq!(probe.height, 8);
    assert_eq!(probe.rgba.len(), 8 * 8 * 4);
}

#[test]
fn probe_first_texture_and_meta_none_when_texture_set_is_empty() {
    // TEXTURE1 present (so `wad.texture_set()` returns `Some`) but with zero
    // texture definitions: covers each function's `textures().is_empty()` /
    // `textures().first()` early-return guard.
    let texture1 = common::build_texture1_empty();
    let pnames = common::build_pnames_empty();
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[("TEXTURE1", &texture1), ("PNAMES", &pnames)],
    ))
    .unwrap();

    assert!(probe_first_texture(&wad).unwrap().is_none());
    assert!(probe_first_texture_meta(&wad).unwrap().is_none());
}

#[test]
fn probe_first_texture_none_when_playpal_missing() {
    // A real texture but no PLAYPAL lump: covers `probe_first_texture`'s
    // playpal guard (`wad.playpal()?` returning `None`).
    let texture1 = common::build_texture1("TEX1", 8, 8);
    let pnames = common::build_pnames_empty();
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[("TEXTURE1", &texture1), ("PNAMES", &pnames)],
    ))
    .unwrap();

    assert!(probe_first_texture(&wad).unwrap().is_none());
}

#[test]
fn probe_first_texture_meta_none_on_negative_dims() {
    let texture1 = common::build_texture1("TEX1", -1, 8);
    let pnames = common::build_pnames_empty();
    let wad = Wad::from_bytes(build_wad(
        *b"IWAD",
        &[("TEXTURE1", &texture1), ("PNAMES", &pnames)],
    ))
    .unwrap();

    assert!(probe_first_texture_meta(&wad).unwrap().is_none());
}
