//! Integration tests for [`crustyview::probe::probe_first_map`] and
//! [`crustyview::probe::probe_first_texture`].

use crustyview::probe::{probe_first_map, probe_first_texture};
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
