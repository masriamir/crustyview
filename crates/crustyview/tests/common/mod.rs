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

/// Build a minimal `TEXTURE1` lump with a single texture definition named
/// `name` (truncated/padded to 8 bytes), given `width`/`height`, and zero
/// patches. Layout (crustywad's `TextureX::parse`): `i32` texture count,
/// then one `i32` offset (from the lump start) per texture, then each
/// texture record: `name[8]`, `masked: i32`, `width: i16`, `height: i16`,
/// `column_directory: i32`, `patchcount: i16`, followed by `patchcount`
/// patch placements (none here).
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_texture1(name: &str, width: i16, height: i16) -> Vec<u8> {
    let mut name8 = [0u8; 8];
    let nb = name.as_bytes();
    assert!(nb.len() <= 8, "texture name {name:?} exceeds 8 bytes");
    name8[..nb.len()].copy_from_slice(nb);

    let mut out = Vec::new();
    out.extend_from_slice(&1i32.to_le_bytes()); // numtextures
    out.extend_from_slice(&8i32.to_le_bytes()); // offset: 4 (count) + 4 (one offset entry)
    out.extend_from_slice(&name8);
    out.extend_from_slice(&0i32.to_le_bytes()); // masked (dead field)
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // column_directory (dead field)
    out.extend_from_slice(&0i16.to_le_bytes()); // patchcount
    out
}

/// Build a `TEXTURE1` lump with zero texture definitions: just the `i32`
/// count field, set to 0.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_texture1_empty() -> Vec<u8> {
    0i32.to_le_bytes().to_vec()
}

/// Build a `PNAMES` lump listing `names` (each truncated/padded to 8 bytes).
/// Layout (crustywad's `Pnames::parse`): `i32` count, then `count × [u8; 8]`
/// names.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_pnames(names: &[&str]) -> Vec<u8> {
    let mut out = Vec::new();
    let count = i32::try_from(names.len()).unwrap();
    out.extend_from_slice(&count.to_le_bytes());
    for name in names {
        let mut padded = [0u8; 8];
        let nb = name.as_bytes();
        assert!(nb.len() <= 8, "patch name {name:?} exceeds 8 bytes");
        padded[..nb.len()].copy_from_slice(nb);
        out.extend_from_slice(&padded);
    }
    out
}

/// Build a `PNAMES` lump with zero patch names: just the `i32` count field.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_pnames_empty() -> Vec<u8> {
    build_pnames(&[])
}

/// Build a `PLAYPAL` lump holding a single all-zero 256-entry RGB palette
/// (768 bytes) — a valid palette for compositing purposes.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_playpal_zero() -> Vec<u8> {
    vec![0u8; 768]
}

/// Build a `TEXTURE1` lump with a single texture definition named `name`
/// (truncated/padded to 8 bytes), given `width`/`height`, referencing one
/// full-canvas patch at `PNAMES` index `patch_index`, placed at `(0, 0)`.
///
/// A texture with a live patch spanning every column avoids
/// `TextureSet::compose`'s Medusa check (every column must have at least
/// one contributing patch in strict mode), unlike a zero-patch texture.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_texture1_with_patch(name: &str, width: i16, height: i16, patch_index: i16) -> Vec<u8> {
    let mut name8 = [0u8; 8];
    let nb = name.as_bytes();
    assert!(nb.len() <= 8, "texture name {name:?} exceeds 8 bytes");
    name8[..nb.len()].copy_from_slice(nb);

    let mut out = Vec::new();
    out.extend_from_slice(&1i32.to_le_bytes()); // numtextures
    out.extend_from_slice(&8i32.to_le_bytes()); // offset: 4 (count) + 4 (one offset entry)
    out.extend_from_slice(&name8);
    out.extend_from_slice(&0i32.to_le_bytes()); // masked (dead field)
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes()); // column_directory (dead field)
    out.extend_from_slice(&1i16.to_le_bytes()); // patchcount
    out.extend_from_slice(&0i16.to_le_bytes()); // origin_x
    out.extend_from_slice(&0i16.to_le_bytes()); // origin_y
    out.extend_from_slice(&patch_index.to_le_bytes());
    out.extend_from_slice(&0i16.to_le_bytes()); // step_dir (dead field)
    out.extend_from_slice(&0i16.to_le_bytes()); // colormap (dead field)
    out
}

/// Build a picture lump (a `PNAMES`-referenced patch) that is fully opaque:
/// every column has a single post spanning the whole height, filled with
/// `pixel`. Layout (crustywad's `Picture::parse`): 4 `i16` header fields
/// (width, height, left offset, top offset), then `width × i32` column
/// offsets (from the lump start), then each column's post chain —
/// `top_delta: u8`, `length: u8`, pad, `length` pixel bytes, pad,
/// terminated by `0xFF`.
#[allow(dead_code)] // some integration test binaries don't exercise this helper
pub fn build_patch_full(width: i16, height: i16, pixel: u8) -> Vec<u8> {
    let w = usize::try_from(width).unwrap();
    let h = usize::try_from(height).unwrap();

    let mut out = Vec::new();
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(&0i16.to_le_bytes()); // left_offset
    out.extend_from_slice(&0i16.to_le_bytes()); // top_offset

    let table_start = out.len();
    out.resize(table_start + w * 4, 0);

    let mut offsets = Vec::with_capacity(w);
    for _ in 0..w {
        offsets.push(i32::try_from(out.len()).unwrap());
        out.push(0); // top_delta
        out.push(u8::try_from(h).unwrap()); // length
        out.push(0); // pad
        out.extend(std::iter::repeat_n(pixel, h));
        out.push(0); // pad
        out.push(0xFF); // terminator: no further posts
    }
    for (i, off) in offsets.into_iter().enumerate() {
        let at = table_start + i * 4;
        out[at..at + 4].copy_from_slice(&off.to_le_bytes());
    }
    out
}
