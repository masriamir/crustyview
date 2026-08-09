//! Flatten an assembled map into 2D view geometry.
//!
//! `map2d` is the phase-1 contract behind the browser's top-down map view
//! (ADR-0002 staging): everything the canvas needs, nothing it doesn't.

use crate::assemble::assemble_view;
use crate::error::sanitize;
use crustywad::Wad;
use crustywad::map::{MapFormat, SidedefIdx};

/// The vanilla `ML_SECRET` linedef flag bit (same bit in Doom, Boom, and
/// Hexen binary maps; crustywad normalizes UDMF's `secret` into it too).
const ML_SECRET: u32 = 0x0020;

/// Linedef action specials that make a line a teleport *source* — vanilla
/// walk-over/monster teleports (39/97/125/126) plus Boom's switch (174/195),
/// silent (207–210), line-to-line (243/244, 262–267), and silent monster-only
/// (268/269) variants. Only meaningful in the Doom special number space;
/// Hexen/UDMF spaces are #67.
const TELEPORT_SPECIALS: [i32; 20] = [
    39, 97, 125, 126, 174, 195, 207, 208, 209, 210, 243, 244, 262, 263, 264, 265, 266, 267, 268,
    269,
];

/// Whether `special` marks a teleport source in `format`'s special space.
/// A dead teleporter (tag 0) still classifies — the special is what makes the
/// line a source; whether it works in-game is not map2d's concern.
fn is_teleport_special(special: i32, format: MapFormat) -> bool {
    format == MapFormat::Doom && TELEPORT_SPECIALS.contains(&special)
}

/// Vanilla damaging-floor sector specials: 4/11/16 (−20%), 5 (−10%), 7 (−5%).
const DAMAGING_SECTOR_SPECIALS: [i32; 5] = [4, 5, 7, 11, 16];

/// The vanilla secret sector special — the intermission "secrets" tally.
const SECRET_SECTOR_SPECIAL: i32 = 9;

/// Boom generalized sector-special bits: damage level in bits 5–6, secret in
/// bit 7. The bit tests need no `>= 32` guard — vanilla specials (0–31) can't
/// set them — and run on the widened value directly: the masks only inspect
/// low bits, so a corrupt negative special can't sign-extend into a false
/// positive. Friction/wind (bits 8/9) are not map2d's concern.
const BOOM_DAMAGE_MASK: i32 = 0x0060;
const BOOM_SECRET_MASK: i32 = 0x0080;

/// Whether `special` marks a secret sector in `format`'s special space —
/// vanilla 9 or the Boom generalized secret bit. Distinct from the
/// `ML_SECRET` *linedef* disguise flag ([`LineKind::Secret`]). Only
/// meaningful in the Doom special number space; Hexen/UDMF/Doom64 sector
/// specials differ and classify unmarked.
fn is_secret_sector_special(special: i32, format: MapFormat) -> bool {
    format == MapFormat::Doom
        && (special == SECRET_SECTOR_SPECIAL || special & BOOM_SECRET_MASK != 0)
}

/// Whether `special` marks a damaging floor in `format`'s special space —
/// vanilla 4/5/7/11/16 or Boom generalized damage bits. Damage strength
/// collapses into one mark. Doom-space only, like
/// [`is_secret_sector_special`].
fn is_damaging_sector_special(special: i32, format: MapFormat) -> bool {
    format == MapFormat::Doom
        && (DAMAGING_SECTOR_SPECIALS.contains(&special) || special & BOOM_DAMAGE_MASK != 0)
}

/// `skip_serializing_if` predicate: omit `false` line marks from the payload.
#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_false(b: &bool) -> bool {
    !*b
}

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
    /// Teleport source mark — the line's action special teleports whatever
    /// crosses or uses it. Omitted from JSON when false.
    #[serde(skip_serializing_if = "is_false")]
    pub teleport: bool,
    /// Secret-sector boundary — a bordering sector classifies as secret.
    /// Orthogonal to `kind`: [`LineKind::Secret`] is the `ML_SECRET` linedef
    /// disguise, this is the sector special. Omitted from JSON when false.
    #[serde(skip_serializing_if = "is_false")]
    pub secret_sector: bool,
    /// Damaging-sector boundary — a bordering sector classifies as damaging.
    /// Omitted from JSON when false.
    #[serde(skip_serializing_if = "is_false")]
    pub damaging_sector: bool,
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
    /// Count of sectors classifying as secret — the map's intermission
    /// "secrets" tally, surfaced on the filter chip.
    pub secret_sectors: usize,
    /// Count of sectors classifying as damaging.
    pub damaging_sectors: usize,
}

/// Flatten the named map group for 2D drawing.
///
/// Bounds cover vertices referenced by lines *and* things; an empty map
/// yields a zero-area bounds at origin.
///
/// # Errors
///
/// Returns a user-facing single-line message when no group has that name or
/// when assembly fails — the real crustywad error is the payload, not a
/// generic fallback (#46). Sanitized as defense-in-depth, like
/// [`crate::error::load_error_message`].
pub fn map2d(wad: &Wad, name: &str) -> Result<Map2d, String> {
    let group = wad
        .map_groups()
        .into_iter()
        .find(|g| g.name == name)
        .ok_or_else(|| sanitize(&format!("no map named {name}")))?;
    let map = assemble_view(wad, &group).map_err(|e| sanitize(&e.to_string()))?;
    let format = map.format();
    // Classify every sector once; each line then looks up its two sides.
    let sector_marks: Vec<(bool, bool)> = map
        .sectors()
        .iter()
        .map(|s| {
            (
                is_secret_sector_special(s.special, format),
                is_damaging_sector_special(s.special, format),
            )
        })
        .collect();
    let secret_sectors = sector_marks.iter().filter(|(secret, _)| *secret).count();
    let damaging_sectors = sector_marks
        .iter()
        .filter(|(_, damaging)| *damaging)
        .count();
    let sidedefs = map.sidedefs();
    // A dangling sidedef/sector reference classifies unmarked — bad geometry
    // degrades, never fails, matching the vertex handling below.
    let side_marks = |side: Option<SidedefIdx>| {
        side.and_then(|idx| sidedefs.get(idx.0))
            .and_then(|sd| sector_marks.get(sd.sector.0))
            .copied()
            .unwrap_or((false, false))
    };
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
            let (right_secret, right_damaging) = side_marks(l.right);
            let (left_secret, left_damaging) = side_marks(l.left);
            Some(Line2d {
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                kind,
                teleport: is_teleport_special(l.special.special, format),
                secret_sector: right_secret || left_secret,
                damaging_sector: right_damaging || left_damaging,
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
    let bounds = bounds_of(&lines, &things);
    Ok(Map2d {
        name: map.name().to_owned(),
        bounds,
        lines,
        things,
        secret_sectors,
        damaging_sectors,
    })
}

/// Inclusive bounds over line endpoints and thing positions; zero-area at the
/// origin when there is no finite geometry (empty map, or a pathological
/// (UDMF) coordinate poisoning a side).
fn bounds_of(lines: &[Line2d], things: &[Thing2d]) -> Bounds {
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
    // All four must be finite: an empty map leaves the folds at ±infinity,
    // and any single side can be poisoned independently.
    let finite = [bounds.min_x, bounds.min_y, bounds.max_x, bounds.max_y]
        .iter()
        .all(|v| v.is_finite());
    if finite {
        bounds
    } else {
        Bounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::{broken_pwad, build_pwad, dangling_blockmap_pwad, tiny_pwad};

    #[test]
    fn flattens_lines_with_kinds_and_bounds() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.name, "MAP01");
        assert_eq!(m.lines.len(), 8);
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
    fn unknown_name_reports_no_such_map() {
        assert_eq!(
            map2d(&tiny_pwad(), "MAP99").unwrap_err(),
            "no map named MAP99"
        );
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
        build_pwad(&[
            ("MAP01", &[]),
            ("THINGS", &[]),
            ("LINEDEFS", &[]),
            ("SIDEDEFS", &[]),
            ("VERTEXES", &[]),
            ("SECTORS", &[]),
        ])
    }

    #[test]
    fn assembly_failure_reports_the_real_error() {
        assert_eq!(
            map2d(&broken_pwad(), "MAP01").unwrap_err(),
            "map group is missing required lump VERTEXES"
        );
    }

    #[test]
    fn a_defective_blockmap_does_not_block_the_view() {
        let m = map2d(&dangling_blockmap_pwad(), "MAP01").expect("the viewer never reads BLOCKMAP");
        assert_eq!(m.lines.len(), 1);
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
        assert_eq!(m.secret_sectors, 0);
        assert_eq!(m.damaging_sectors, 0);
    }

    #[test]
    fn teleport_specials_classify_by_format() {
        let listed = [
            39, 97, 125, 126, 174, 195, 207, 208, 209, 210, 243, 244, 262, 263, 264, 265, 266, 267,
            268, 269,
        ];
        for special in listed {
            assert!(
                is_teleport_special(special, MapFormat::Doom),
                "special {special} should classify on Doom-format maps"
            );
        }
        for special in [0, 1, 40, 173, 196, 206, 211, 242, 245, 261, 270] {
            assert!(
                !is_teleport_special(special, MapFormat::Doom),
                "special {special} is not a teleport"
            );
        }
        for format in [MapFormat::Hexen, MapFormat::Udmf, MapFormat::Doom64] {
            assert!(
                !is_teleport_special(39, format) && !is_teleport_special(97, format),
                "{format:?} has a different special number space"
            );
        }
    }

    #[test]
    fn sector_specials_classify_by_format() {
        assert!(is_secret_sector_special(9, MapFormat::Doom));
        for special in [4, 5, 7, 11, 16] {
            assert!(
                is_damaging_sector_special(special, MapFormat::Doom),
                "vanilla damaging special {special}"
            );
            assert!(
                !is_secret_sector_special(special, MapFormat::Doom),
                "damaging special {special} is not secret"
            );
        }
        // Boom generalized bits: damage level in bits 5–6, secret in bit 7.
        for special in [0x20, 0x40, 0x60, 0xE0] {
            assert!(
                is_damaging_sector_special(special, MapFormat::Doom),
                "Boom damage bits in {special:#x}"
            );
        }
        for special in [0x80, 0xE0] {
            assert!(
                is_secret_sector_special(special, MapFormat::Doom),
                "Boom secret bit in {special:#x}"
            );
        }
        assert!(
            !is_damaging_sector_special(0x80, MapFormat::Doom),
            "secret-only Boom special does not damage"
        );
        assert!(
            !is_secret_sector_special(0x60, MapFormat::Doom),
            "damage-only Boom special is not secret"
        );
        for special in [0, 1, 3, 8, 10, 17, 31] {
            assert!(
                !is_secret_sector_special(special, MapFormat::Doom),
                "special {special} is not secret"
            );
            assert!(
                !is_damaging_sector_special(special, MapFormat::Doom),
                "special {special} is not damaging"
            );
        }
        // Other formats have different sector-special number spaces.
        for format in [MapFormat::Hexen, MapFormat::Udmf, MapFormat::Doom64] {
            assert!(
                !is_secret_sector_special(9, format) && !is_damaging_sector_special(5, format),
                "{format:?} classifies unmarked"
            );
        }
    }

    #[test]
    fn marks_teleport_source_lines() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert!(
            m.lines[..3].iter().all(|l| !l.teleport),
            "plain lines stay unmarked"
        );
        assert!(m.lines[3].teleport);
        assert_eq!(m.lines[3].kind, LineKind::OneSided);
        assert!(m.lines[4].teleport);
        assert_eq!(
            m.lines[4].kind,
            LineKind::Secret,
            "secret survives the teleport mark"
        );
    }

    #[test]
    fn teleport_field_skips_false_in_json() {
        let m = map2d(&tiny_pwad(), "MAP01").unwrap();
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json.matches("\"teleport\":true").count(), 2);
        assert!(!json.contains("\"teleport\":false"));
    }

    #[test]
    fn marks_sector_boundary_lines() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert!(
            m.lines[..5]
                .iter()
                .all(|l| !l.secret_sector && !l.damaging_sector),
            "lines bordering only the plain sector stay unmarked"
        );
        assert!(m.lines[5].secret_sector && !m.lines[5].damaging_sector);
        assert!(
            !m.lines[6].secret_sector && m.lines[6].damaging_sector,
            "a left-side-only sector still marks the line"
        );
        assert!(
            m.lines[7].secret_sector && m.lines[7].damaging_sector,
            "Boom combined bits mark both"
        );
    }

    #[test]
    fn counts_classified_sectors() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.secret_sectors, 2, "vanilla 9 + Boom secret bit");
        assert_eq!(m.damaging_sectors, 2, "vanilla 5 + Boom damage bits");
    }

    #[test]
    fn sector_fields_skip_false_in_json() {
        let m = map2d(&tiny_pwad(), "MAP01").unwrap();
        let json = serde_json::to_string(&m).unwrap();
        assert_eq!(json.matches("\"secret_sector\":true").count(), 2);
        assert_eq!(json.matches("\"damaging_sector\":true").count(), 2);
        assert!(!json.contains("\"secret_sector\":false"));
        assert!(!json.contains("\"damaging_sector\":false"));
        assert!(json.contains("\"secret_sectors\":2"));
        assert!(json.contains("\"damaging_sectors\":2"));
    }
}
