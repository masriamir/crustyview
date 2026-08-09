//! Synthetic-PWAD builders shared by the crate's unit tests.

use crustywad::Wad;

/// A lump/texture name padded to the on-disk 8-byte field.
pub(crate) fn name8(n: &str) -> [u8; 8] {
    assert!(n.len() <= 8, "lump name {n:?} exceeds the 8-byte WAD limit");
    let mut b = [0u8; 8];
    b[..n.len()].copy_from_slice(n.as_bytes());
    b
}

/// Assemble a PWAD from named lumps: header + bodies + directory.
pub(crate) fn build_pwad(lumps: &[(&str, &[u8])]) -> Wad {
    let mut body = Vec::new();
    let mut directory = Vec::new();
    for (name, data) in lumps {
        let filepos = 12 + body.len();
        body.extend_from_slice(data);
        directory.extend_from_slice(&i32::try_from(filepos).unwrap().to_le_bytes());
        directory.extend_from_slice(&i32::try_from(data.len()).unwrap().to_le_bytes());
        directory.extend_from_slice(&name8(name));
    }
    let mut bytes = b"PWAD".to_vec();
    bytes.extend_from_slice(&i32::try_from(lumps.len()).unwrap().to_le_bytes());
    bytes.extend_from_slice(&i32::try_from(12 + body.len()).unwrap().to_le_bytes());
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(&directory);
    Wad::from_bytes(bytes).expect("synthetic PWAD parses")
}

/// Build a minimal single-map PWAD from raw lumps: a right triangle of 3
/// vertices, 8 linedefs (one two-sided, one secret-flagged, two teleport
/// sources, three bordering marked sectors), 4 sectors (plain, secret 9,
/// damaging 5, Boom secret+damage 0xE0), 5 sidedefs, and 2 things
/// (P1 start + an imp).
pub(crate) fn tiny_pwad() -> Wad {
    // Lump payloads (little-endian throughout).
    let vertexes: Vec<u8> = [(0i16, 0i16), (128, 0), (0, 128)]
        .iter()
        .flat_map(|(x, y)| [x.to_le_bytes(), y.to_le_bytes()].concat())
        .collect();
    // LINEDEFS: start, end, flags, special, tag, right sidedef, left sidedef (7 × u16)
    let linedefs: Vec<u8> = [
        [0u16, 1, 0x0000, 0, 0, 0, 0xFFFF],  // one-sided
        [1u16, 2, 0x0004, 0, 0, 0, 1],       // two-sided (ML_TWOSIDED set, both sides)
        [2u16, 0, 0x0020, 0, 0, 0, 0xFFFF],  // secret-flagged
        [0u16, 1, 0x0000, 39, 1, 0, 0xFFFF], // teleport source (W1 teleport, special 39)
        [1u16, 2, 0x0020, 97, 1, 0, 0xFFFF], // secret + teleport source (WR teleport, special 97)
        [0u16, 1, 0x0000, 0, 0, 2, 0xFFFF],  // one-sided into the secret sector (1)
        [1u16, 2, 0x0004, 0, 0, 0, 3],       // two-sided; damaging sector (2) on the left only
        [2u16, 0, 0x0000, 0, 0, 4, 0xFFFF],  // one-sided into the Boom secret+damage sector (3)
    ]
    .iter()
    .flat_map(|r| r.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>())
    .collect();
    // SIDEDEFS: xoff, yoff (i16), upper/lower/middle names, sector (u16)
    let sidedef = |sector: u16| {
        let mut b = Vec::new();
        b.extend_from_slice(&0i16.to_le_bytes());
        b.extend_from_slice(&0i16.to_le_bytes());
        b.extend_from_slice(&name8("-"));
        b.extend_from_slice(&name8("-"));
        b.extend_from_slice(&name8("STARTAN3"));
        b.extend_from_slice(&sector.to_le_bytes());
        b
    };
    let sidedefs: Vec<u8> = [sidedef(0), sidedef(0), sidedef(1), sidedef(2), sidedef(3)].concat();
    // SECTORS: floor h, ceil h (i16), floor/ceil flat names, light, special, tag (u16 × 3)
    let sector = |special: u16| {
        let mut b = Vec::new();
        b.extend_from_slice(&0i16.to_le_bytes());
        b.extend_from_slice(&128i16.to_le_bytes());
        b.extend_from_slice(&name8("FLOOR0_1"));
        b.extend_from_slice(&name8("CEIL1_1"));
        for v in [160u16, special, 0] {
            b.extend_from_slice(&v.to_le_bytes());
        }
        b
    };
    let sectors: Vec<u8> = [sector(0), sector(9), sector(5), sector(0xE0)].concat();
    // THINGS: x, y (i16), angle, type, flags (u16)
    let things: Vec<u8> = [
        [32i16 as u16, 32, 90, 1, 7], // player 1 start
        [64u16, 16, 0, 3001, 7],      // imp
    ]
    .iter()
    .flat_map(|r| r.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>())
    .collect();

    build_pwad(&[
        ("MAP01", &[]),
        ("THINGS", &things),
        ("LINEDEFS", &linedefs),
        ("SIDEDEFS", &sidedefs),
        ("VERTEXES", &vertexes),
        ("SECTORS", &sectors),
    ])
}

/// A PWAD whose MAP01 group lacks the required VERTEXES lump.
pub(crate) fn broken_pwad() -> Wad {
    build_pwad(&[
        ("MAP01", &[]),
        ("THINGS", &[]),
        ("LINEDEFS", &[]),
        ("SIDEDEFS", &[]),
        ("SECTORS", &[]),
    ])
}
