//! Shared WAD-building helpers for crustyview's integration tests.

/// Build minimal WAD bytes. `magic` is `*b"IWAD"` or `*b"PWAD"`.
/// Layout: 12-byte header, lump data, then the directory.
pub fn build_wad(magic: [u8; 4], lumps: &[(&str, &[u8])]) -> Vec<u8> {
    let mut data = Vec::new();
    let mut dir = Vec::new();
    let mut offset: i32 = 12; // data begins after the header
    for (name, bytes) in lumps {
        let size = i32::try_from(bytes.len()).unwrap();
        dir.extend_from_slice(&offset.to_le_bytes());
        dir.extend_from_slice(&size.to_le_bytes());
        let mut name8 = [0u8; 8];
        let nb = name.as_bytes();
        assert!(nb.len() <= 8, "lump name {name:?} exceeds 8 bytes");
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
