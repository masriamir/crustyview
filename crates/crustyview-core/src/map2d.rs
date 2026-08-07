//! Flatten an assembled map into 2D view geometry.
//!
//! `map2d` is the phase-1 contract behind the browser's top-down map view
//! (ADR-0002 staging): everything the canvas needs, nothing it doesn't.

use crustywad::Wad;
use crustywad::map::Map;

/// The vanilla `ML_SECRET` linedef flag bit (same bit in Doom, Boom, and
/// Hexen binary maps; crustywad normalizes UDMF's `secret` into it too).
const ML_SECRET: u32 = 0x0020;

/// How a line should read on the automap.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    /// Solid wall — one sidedef.
    OneSided,
    /// Passable boundary — sidedefs on both sides.
    TwoSided,
    /// Flagged `ML_SECRET`, drawn distinctly.
    Secret,
}

/// One drawable line segment in map units.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Line2d {
    /// X coordinate of line start.
    pub x1: f64,
    /// Y coordinate of line start.
    pub y1: f64,
    /// X coordinate of line end.
    pub x2: f64,
    /// Y coordinate of line end.
    pub y2: f64,
    /// Line classification for rendering.
    pub kind: LineKind,
}

/// One thing marker in map units. `type_id` crosses from day one so
/// category filtering later is UI-only.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Thing2d {
    /// X coordinate in map units.
    pub x: f64,
    /// Y coordinate in map units.
    pub y: f64,
    /// Facing angle in degrees.
    pub angle: u16,
    /// Thing type identifier.
    pub type_id: u16,
}

/// Inclusive geometry bounds in map units.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Bounds {
    /// Minimum X coordinate.
    pub min_x: f64,
    /// Minimum Y coordinate.
    pub min_y: f64,
    /// Maximum X coordinate.
    pub max_x: f64,
    /// Maximum Y coordinate.
    pub max_y: f64,
}

/// Everything the 2D map view draws, in map units.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Map2d {
    /// The map's name.
    pub name: String,
    /// Geometry bounds covering all vertices and things.
    pub bounds: Bounds,
    /// Drawable line segments.
    pub lines: Vec<Line2d>,
    /// Thing markers.
    pub things: Vec<Thing2d>,
}

/// Flatten the named map group for 2D drawing.
///
/// Returns `None` when no group has that name or assembly fails
/// (best-effort, like the probes). Bounds cover vertices referenced by
/// lines *and* things; an empty map yields a zero-area bounds at origin.
#[must_use]
pub fn map2d(wad: &Wad, name: &str) -> Option<Map2d> {
    let group = wad.map_groups().into_iter().find(|g| g.name == name)?;
    let map = Map::assemble(wad, &group).ok()?;
    let vertices = map.vertices();
    let lines: Vec<Line2d> = map
        .linedefs()
        .iter()
        .filter_map(|l| {
            let a = vertices.get(l.start.0)?;
            let b = vertices.get(l.end.0)?;
            let kind = if l.flags & ML_SECRET != 0 {
                LineKind::Secret
            } else if l.right.is_some() && l.left.is_some() {
                LineKind::TwoSided
            } else {
                LineKind::OneSided
            };
            Some(Line2d {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                kind,
            })
        })
        .collect();
    let things: Vec<Thing2d> = map
        .things()
        .iter()
        .map(|t| Thing2d {
            x: t.x,
            y: t.y,
            angle: t.angle,
            type_id: t.type_id,
        })
        .collect();
    let xs = lines
        .iter()
        .flat_map(|l| [l.x1, l.x2])
        .chain(things.iter().map(|t| t.x));
    let ys = lines
        .iter()
        .flat_map(|l| [l.y1, l.y2])
        .chain(things.iter().map(|t| t.y));
    let bounds = Bounds {
        min_x: xs.clone().fold(f64::INFINITY, f64::min),
        min_y: ys.clone().fold(f64::INFINITY, f64::min),
        max_x: xs.fold(f64::NEG_INFINITY, f64::max),
        max_y: ys.fold(f64::NEG_INFINITY, f64::max),
    };
    let bounds = if bounds.min_x.is_finite() {
        bounds
    } else {
        Bounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        }
    };
    Some(Map2d {
        name: map.name().to_owned(),
        bounds,
        lines,
        things,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal single-map PWAD from raw lumps: a right triangle of 3
    /// vertices, 3 linedefs (one two-sided, one secret-flagged), 1 sector,
    /// 2 sidedefs, and 2 things (P1 start + an imp).
    fn tiny_pwad() -> Wad {
        fn name8(n: &str) -> [u8; 8] {
            let mut b = [0u8; 8];
            b[..n.len()].copy_from_slice(n.as_bytes());
            b
        }
        // Lump payloads (little-endian throughout).
        let vertexes: Vec<u8> = [(0i16, 0i16), (128, 0), (0, 128)]
            .iter()
            .flat_map(|(x, y)| [x.to_le_bytes(), y.to_le_bytes()].concat())
            .collect();
        // LINEDEFS: start, end, flags, special, tag, right sidedef, left sidedef (7 × u16)
        let linedefs: Vec<u8> = [
            [0u16, 1, 0x0000, 0, 0, 0, 0xFFFF], // one-sided
            [1u16, 2, 0x0004, 0, 0, 0, 1],      // two-sided (ML_TWOSIDED set, both sides)
            [2u16, 0, 0x0020, 0, 0, 0, 0xFFFF], // secret-flagged
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
        let sidedefs: Vec<u8> = [sidedef(0), sidedef(0)].concat();
        // SECTORS: floor h, ceil h (i16), floor/ceil flat names, light, special, tag (u16 × 3)
        let mut sectors = Vec::new();
        sectors.extend_from_slice(&0i16.to_le_bytes());
        sectors.extend_from_slice(&128i16.to_le_bytes());
        sectors.extend_from_slice(&name8("FLOOR0_1"));
        sectors.extend_from_slice(&name8("CEIL1_1"));
        for v in [160u16, 0, 0] {
            sectors.extend_from_slice(&v.to_le_bytes());
        }
        // THINGS: x, y (i16), angle, type, flags (u16)
        let things: Vec<u8> = [
            [32i16 as u16, 32, 90, 1, 7], // player 1 start
            [64u16, 16, 0, 3001, 7],      // imp
        ]
        .iter()
        .flat_map(|r| r.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>())
        .collect();

        // Assemble the PWAD: header + lumps + directory.
        let lumps: [(&str, &[u8]); 6] = [
            ("MAP01", &[]),
            ("THINGS", &things),
            ("LINEDEFS", &linedefs),
            ("SIDEDEFS", &sidedefs),
            ("VERTEXES", &vertexes),
            ("SECTORS", &sectors),
        ];
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
        bytes.extend_from_slice(&6i32.to_le_bytes());
        bytes.extend_from_slice(&i32::try_from(12 + body.len()).unwrap().to_le_bytes());
        bytes.extend_from_slice(&body);
        bytes.extend_from_slice(&directory);
        Wad::from_bytes(bytes).expect("tiny PWAD parses")
    }

    #[test]
    fn flattens_lines_with_kinds_and_bounds() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.name, "MAP01");
        assert_eq!(m.lines.len(), 3);
        assert_eq!(m.lines[0].kind, LineKind::OneSided);
        assert_eq!(m.lines[1].kind, LineKind::TwoSided);
        assert_eq!(m.lines[2].kind, LineKind::Secret);
        assert_eq!((m.lines[0].x1, m.lines[0].y1), (0.0, 0.0));
        assert_eq!((m.lines[0].x2, m.lines[0].y2), (128.0, 0.0));
        assert_eq!(
            (
                m.bounds.min_x,
                m.bounds.min_y,
                m.bounds.max_x,
                m.bounds.max_y
            ),
            (0.0, 0.0, 128.0, 128.0)
        );
    }

    #[test]
    fn carries_things_with_type_ids() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.things.len(), 2);
        assert_eq!((m.things[0].x, m.things[0].y), (32.0, 32.0));
        assert_eq!(m.things[0].angle, 90);
        assert_eq!(m.things[0].type_id, 1);
        assert_eq!(m.things[1].type_id, 3001);
    }

    #[test]
    fn unknown_name_is_none() {
        assert!(map2d(&tiny_pwad(), "MAP99").is_none());
    }

    #[test]
    fn json_is_snake_case() {
        let m = map2d(&tiny_pwad(), "MAP01").unwrap();
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("\"min_x\""));
        assert!(json.contains("\"type_id\""));
        assert!(json.contains("\"one_sided\""));
    }

    /// Build a PWAD with an empty map: all five lumps present but zero-length.
    /// Tests the zero-area bounds fallback when no geometry exists.
    fn empty_pwad() -> Wad {
        fn name8(n: &str) -> [u8; 8] {
            let mut b = [0u8; 8];
            b[..n.len()].copy_from_slice(n.as_bytes());
            b
        }
        // Empty lump payloads
        let vertexes: Vec<u8> = Vec::new();
        let linedefs: Vec<u8> = Vec::new();
        let sidedefs: Vec<u8> = Vec::new();
        let sectors: Vec<u8> = Vec::new();
        let things: Vec<u8> = Vec::new();

        // Assemble the PWAD: header + lumps + directory.
        let lumps: [(&str, &[u8]); 6] = [
            ("MAP01", &[]),
            ("THINGS", &things),
            ("LINEDEFS", &linedefs),
            ("SIDEDEFS", &sidedefs),
            ("VERTEXES", &vertexes),
            ("SECTORS", &sectors),
        ];
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
        bytes.extend_from_slice(&6i32.to_le_bytes());
        bytes.extend_from_slice(&i32::try_from(12 + body.len()).unwrap().to_le_bytes());
        bytes.extend_from_slice(&body);
        bytes.extend_from_slice(&directory);
        Wad::from_bytes(bytes).expect("empty PWAD parses")
    }

    #[test]
    fn empty_map_yields_zero_bounds() {
        let m = map2d(&empty_pwad(), "MAP01").expect("assembles empty map");
        assert_eq!(m.name, "MAP01");
        assert_eq!(m.lines.len(), 0, "empty map has no lines");
        assert_eq!(m.things.len(), 0, "empty map has no things");
        assert_eq!(
            (
                m.bounds.min_x,
                m.bounds.min_y,
                m.bounds.max_x,
                m.bounds.max_y
            ),
            (0.0, 0.0, 0.0, 0.0),
            "empty map yields zero-area bounds at origin"
        );
    }
}
