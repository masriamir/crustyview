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
