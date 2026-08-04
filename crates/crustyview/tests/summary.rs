//! Integration tests for [`crustyview::summary::summarize`].

use crustyview::summary::summarize;

/// Build minimal WAD bytes. `magic` is `*b"IWAD"` or `*b"PWAD"`.
/// Layout: 12-byte header, lump data, then the directory.
fn build_wad(magic: [u8; 4], lumps: &[(&str, &[u8])]) -> Vec<u8> {
    let mut data = Vec::new();
    let mut dir = Vec::new();
    let mut offset: i32 = 12; // data begins after the header
    for (name, bytes) in lumps {
        let size = i32::try_from(bytes.len()).unwrap();
        dir.extend_from_slice(&offset.to_le_bytes());
        dir.extend_from_slice(&size.to_le_bytes());
        let mut name8 = [0u8; 8];
        let nb = name.as_bytes();
        name8[..nb.len()].copy_from_slice(nb);
        dir.extend_from_slice(&name8);
        data.extend_from_slice(bytes);
        offset += size;
    }
    let numlumps = i32::try_from(lumps.len()).unwrap();
    let infotableofs = offset; // directory begins after header+data
    let mut out = Vec::new();
    out.extend_from_slice(&magic);
    out.extend_from_slice(&numlumps.to_le_bytes());
    out.extend_from_slice(&infotableofs.to_le_bytes());
    out.extend_from_slice(&data);
    out.extend_from_slice(&dir);
    out
}

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
