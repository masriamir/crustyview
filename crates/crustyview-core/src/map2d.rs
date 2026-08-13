//! Flatten an assembled map into 2D view geometry.
//!
//! `map2d` is the phase-1 contract behind the browser's top-down map view
//! (ADR-0002 staging): everything the canvas needs, nothing it doesn't.

use crate::assemble::assemble_view;
use crate::error::sanitize;
use crustywad::Wad;
use crustywad::map::{Map, MapFormat, SidedefIdx};

/// The vanilla `ML_SECRET` linedef flag bit (same bit in Doom, Boom, and
/// Hexen binary maps; crustywad normalizes UDMF's `secret` into it too).
const ML_SECRET: u32 = 0x0020;

/// Linedef action specials that make a line a teleport *source* — vanilla
/// walk-over/monster teleports (39/97/125/126) plus Boom's switch (174/195),
/// silent (207–210), line-to-line (243/244, 262–267), and silent monster-only
/// (268/269) variants. Only meaningful in the Doom special number space;
/// Hexen variants are in [`HEXEN_TELEPORT_SPECIALS`].
const TELEPORT_SPECIALS: [i32; 20] = [
    39, 97, 125, 126, 174, 195, 207, 208, 209, 210, 243, 244, 262, 263, 264, 265, 266, 267, 268,
    269,
];

/// Hexen/ZDoom action specials that make a line a teleport *source*.
/// `74` `Teleport_NewMap` and `75` `Teleport_EndGame` are deliberately absent —
/// they exit the level rather than teleporting within it. `76` `TeleportOther`
/// relocates a different actor, so it classifies but never yields a link.
const HEXEN_TELEPORT_SPECIALS: [i32; 4] = [70, 71, 76, 215];

/// Doom-space teleport specials whose `args[0]` names a destination **sector**.
const DOOM_SECTOR_TELEPORTS: [i32; 12] = [39, 97, 125, 126, 174, 195, 207, 208, 209, 210, 268, 269];
/// Doom-space teleport specials whose `args[0]` names a destination **linedef**
/// (Boom's line-to-line variants).
const DOOM_LINE_TELEPORTS: [i32; 8] = [243, 244, 262, 263, 264, 265, 266, 267];

/// UDMF namespaces that keep the Doom special number space.
const DOOM_NAMESPACES: [&str; 3] = ["doom", "heretic", "strife"];
/// UDMF namespaces that use the Hexen special number space.
const HEXEN_NAMESPACES: [&str; 2] = ["hexen", "zdoom"];

/// Whether `special` marks a teleport source in `format`'s special space.
/// A dead teleporter (tag 0) still classifies — the special is what makes the
/// line a source; whether it works in-game is not map2d's concern.
///
/// `namespace` is the map's UDMF `namespace` declaration and is only consulted
/// for [`MapFormat::Udmf`], whose special space depends on it. An unrecognized
/// namespace classifies nothing rather than guessing at a numbering: a missing
/// teleport mark is a gap, a wrong one is a lie.
fn is_teleport_special(special: i32, format: MapFormat, namespace: Option<&str>) -> bool {
    match format {
        MapFormat::Doom => TELEPORT_SPECIALS.contains(&special),
        MapFormat::Hexen => HEXEN_TELEPORT_SPECIALS.contains(&special),
        MapFormat::Udmf => match namespace {
            Some(ns) if DOOM_NAMESPACES.contains(&ns) => TELEPORT_SPECIALS.contains(&special),
            Some(ns) if HEXEN_NAMESPACES.contains(&ns) => {
                HEXEN_TELEPORT_SPECIALS.contains(&special)
            }
            _ => false,
        },
        // Two distinct reasons share this arm, merged because `MapFormat` is
        // `#[non_exhaustive]` (so the wildcard is mandatory) and splitting them
        // trips `clippy::match_same_arms` under `-D warnings`:
        //
        // 1. **Doom 64** has its own special space, and crustywad exposes only
        //    the raw number with no semantics — classifying it would mean
        //    asserting values no source in this repo can confirm (#146).
        // 2. **Any future crustywad format** lands here *silently* — no E0004,
        //    no lint, nothing to prompt a revisit. Unclassified is the right
        //    default (a missing mark is a gap, a wrong one is a lie), but it is
        //    invisible, so check this match by hand when the crustywad pin bumps.
        MapFormat::Doom64 | _ => false,
    }
}

/// A teleport source and its destination, in map units. Grouped: one link per
/// (destination, source sector), so a four-line teleporter pad draws once
/// rather than four times.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct TeleportLink {
    /// The source pad's center.
    pub from: [f64; 2],
    /// Where it lands.
    pub to: [f64; 2],
}

/// The minimal view of a linedef that link building needs. A projection rather
/// than crustywad's `MapLinedef` so the builder is a pure function over owned
/// data — every case, including Hexen, is testable without WAD bytes.
pub(crate) struct LinkLine {
    pub start: (f64, f64),
    pub end: (f64, f64),
    pub special: i32,
    pub args: [i32; 5],
    pub id: i32,
    /// Sector indices behind the right and left sidedefs.
    pub sectors: (Option<usize>, Option<usize>),
}

#[derive(Clone, Copy)]
pub(crate) struct LinkSector {
    pub tag: i32,
}

#[derive(Clone, Copy)]
pub(crate) struct LinkThing {
    pub id: i32,
    pub x: f64,
    pub y: f64,
}

pub(crate) struct LinkInputs<'a> {
    pub lines: &'a [LinkLine],
    pub sectors: &'a [LinkSector],
    pub things: &'a [LinkThing],
    pub format: MapFormat,
    pub namespace: Option<&'a str>,
}

/// What a teleport source points at, before it is resolved to a point.
#[derive(PartialEq, Eq, Hash, Clone, Copy)]
enum LinkTarget {
    /// A sector carrying this tag.
    Sector(i32),
    /// A linedef carrying this tag in `args[0]` (Boom line-to-line).
    LineByTag(i32),
    /// A linedef carrying this id (Hexen `215`).
    LineById(i32),
    /// A thing carrying this tid (Hexen `70`/`71`).
    Thing(i32),
}

/// Where a teleport source points, or `None` when the special yields no link.
/// Never reads beyond `args[1]`: the per-special sector-tag fallback arguments
/// sit at a different index in each Hexen special, and a wrong index mislinks
/// silently rather than failing.
fn link_target(line: &LinkLine, format: MapFormat, namespace: Option<&str>) -> Option<LinkTarget> {
    if !is_teleport_special(line.special, format, namespace) {
        return None;
    }
    let doom_space = matches!(format, MapFormat::Doom)
        || matches!(namespace, Some(ns) if DOOM_NAMESPACES.contains(&ns));
    if doom_space {
        if DOOM_SECTOR_TELEPORTS.contains(&line.special) {
            return Some(LinkTarget::Sector(line.args[0]));
        }
        if DOOM_LINE_TELEPORTS.contains(&line.special) {
            return Some(LinkTarget::LineByTag(line.args[0]));
        }
        return None;
    }
    match line.special {
        70 | 71 => Some(LinkTarget::Thing(line.args[0])),
        215 => Some(LinkTarget::LineById(line.args[1])),
        // `76` TeleportOther relocates a different actor than the one crossing,
        // so a source->destination link would misrepresent it.
        _ => None,
    }
}

/// The midpoint of a line.
fn midpoint(l: &LinkLine) -> [f64; 2] {
    [
        f64::midpoint(l.start.0, l.end.0),
        f64::midpoint(l.start.1, l.end.1),
    ]
}

/// The mean of every endpoint of `lines`, or `None` when there are none.
fn centroid(points: &[(f64, f64)]) -> Option<[f64; 2]> {
    if points.is_empty() {
        return None;
    }
    // A map's point count is bounded by its lump sizes (at most tens of
    // thousands of vertices), nowhere near f64's 52-bit mantissa.
    #[allow(clippy::cast_precision_loss)]
    let n = points.len() as f64;
    let (sx, sy) = points
        .iter()
        .fold((0.0, 0.0), |(ax, ay), (x, y)| (ax + x, ay + y));
    Some([sx / n, sy / n])
}

/// Resolve a target to a point. Lowest index wins when several candidates
/// share a tag: deterministic, and close to engine behavior. Tag/id `0` never
/// matches — it is the binary "no tag" value, so all four zero-valued variants
/// share this arm (`match_same_arms` would otherwise flag it split in two, and
/// this repo runs clippy with `-D warnings`).
fn resolve(target: LinkTarget, inp: &LinkInputs) -> Option<[f64; 2]> {
    match target {
        LinkTarget::Sector(0)
        | LinkTarget::LineByTag(0)
        | LinkTarget::LineById(0)
        | LinkTarget::Thing(0) => None,
        LinkTarget::Sector(tag) => {
            let idx = inp.sectors.iter().position(|s| s.tag == tag)?;
            // A sector's boundary vertices are the endpoints of every line with
            // a sidedef facing it, either side. No polygon, so the
            // self-referencing-sector problem never arises (#49).
            let points: Vec<(f64, f64)> = inp
                .lines
                .iter()
                .filter(|l| l.sectors.0 == Some(idx) || l.sectors.1 == Some(idx))
                .flat_map(|l| [l.start, l.end])
                .collect();
            centroid(&points)
        }
        LinkTarget::LineByTag(tag) => inp
            .lines
            .iter()
            .find(|l| l.args[0] == tag && !DOOM_LINE_TELEPORTS.contains(&l.special))
            .map(midpoint),
        LinkTarget::LineById(id) => inp.lines.iter().find(|l| l.id == id).map(midpoint),
        LinkTarget::Thing(tid) => inp.things.iter().find(|t| t.id == tid).map(|t| [t.x, t.y]),
    }
}

/// A link group's key: its target, the source sector behind the grouped
/// lines (when they share one), and a per-line fallback that keeps a
/// sideless line from being merged into an unrelated group (see
/// [`build_teleport_links`]).
type LinkGroupKey = (LinkTarget, Option<usize>, usize);

/// Build one link per (destination, source sector). The source point is the
/// centroid of that group's line endpoints, so a four-line pad draws a single
/// link from its middle rather than four overlapping ones.
pub(crate) fn build_teleport_links(inp: &LinkInputs) -> Vec<TeleportLink> {
    // Keyed by (target, source sector). A line with neither sidedef groups
    // alone under its own index, so it still draws rather than being dropped.
    let mut groups: Vec<(LinkGroupKey, Vec<(f64, f64)>)> = Vec::new();
    for (i, l) in inp.lines.iter().enumerate() {
        let Some(target) = link_target(l, inp.format, inp.namespace) else {
            continue;
        };
        let sector = l.sectors.0.or(l.sectors.1);
        let key = (target, sector, if sector.is_some() { 0 } else { i });
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, pts)) => pts.extend([l.start, l.end]),
            None => groups.push((key, vec![l.start, l.end])),
        }
    }
    groups
        .into_iter()
        .filter_map(|((target, _, _), pts)| {
            Some(TeleportLink {
                from: centroid(&pts)?,
                to: resolve(target, inp)?,
            })
        })
        .collect()
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
    /// Teleport source-to-destination links, one per teleporter. Omitted from
    /// JSON when empty.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<TeleportLink>,
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
    // Only meaningful for UDMF; `None` for every binary format.
    let namespace = map.namespace();
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
                teleport: is_teleport_special(l.special.special, format, namespace),
                secret_sector: right_secret || left_secret,
                damaging_sector: right_damaging || left_damaging,
            })
        })
        .collect();
    let teleport_links = teleport_links_for(&map, format, namespace);
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
        links: teleport_links,
    })
}

/// Project `map`'s linedefs, sectors, and things into the minimal shape
/// [`build_teleport_links`] needs, then build the links. Split out of
/// [`map2d`] to keep that function under clippy's line-count lint.
fn teleport_links_for(map: &Map, format: MapFormat, namespace: Option<&str>) -> Vec<TeleportLink> {
    let vertices = map.vertices();
    let sidedefs = map.sidedefs();
    let link_lines: Vec<LinkLine> = map
        .linedefs()
        .iter()
        .filter_map(|l| {
            let a = vertices.get(l.start.0)?;
            let b = vertices.get(l.end.0)?;
            let sector_of = |side: Option<SidedefIdx>| {
                side.and_then(|idx| sidedefs.get(idx.0))
                    .map(|sd| sd.sector.0)
            };
            Some(LinkLine {
                start: (a.x, a.y),
                end: (b.x, b.y),
                special: l.special.special,
                args: l.special.args,
                id: l.id,
                sectors: (sector_of(l.right), sector_of(l.left)),
            })
        })
        .collect();
    let link_sectors: Vec<LinkSector> = map
        .sectors()
        .iter()
        .map(|s| LinkSector { tag: s.tag })
        .collect();
    let link_things: Vec<LinkThing> = map
        .things()
        .iter()
        .map(|t| LinkThing {
            id: t.id,
            x: t.x,
            y: t.y,
        })
        .collect();
    build_teleport_links(&LinkInputs {
        lines: &link_lines,
        sectors: &link_sectors,
        things: &link_things,
        format,
        namespace,
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
// The link tests below assert exact `TeleportLink` coordinates computed from
// centroids/midpoints of hand-picked, power-of-two-friendly inputs — the
// arithmetic is exact in `f64`, so strict equality is the right check, not a
// fragile one.
#[allow(clippy::float_cmp)]
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
        for special in TELEPORT_SPECIALS {
            assert!(
                is_teleport_special(special, MapFormat::Doom, None),
                "special {special} is a Doom teleport"
            );
        }
        for special in [0, 1, 38, 40, 96, 98, 270] {
            assert!(
                !is_teleport_special(special, MapFormat::Doom, None),
                "special {special} is not a teleport"
            );
        }
        // Doom numbers are meaningless in the Hexen space and vice versa.
        assert!(!is_teleport_special(39, MapFormat::Hexen, None));
        assert!(!is_teleport_special(70, MapFormat::Doom, None));
        for special in HEXEN_TELEPORT_SPECIALS {
            assert!(
                is_teleport_special(special, MapFormat::Hexen, None),
                "special {special} is a Hexen teleport"
            );
        }
        // Level exits, not in-map teleports.
        for special in [74, 75] {
            assert!(
                !is_teleport_special(special, MapFormat::Hexen, None),
                "special {special} exits the level rather than teleporting within it"
            );
        }
        // Doom64 has its own space, which crustywad exposes no semantics for.
        assert!(!is_teleport_special(39, MapFormat::Doom64, None));
        assert!(!is_teleport_special(70, MapFormat::Doom64, None));
    }

    #[test]
    fn udmf_classifies_by_namespace() {
        // The base namespaces keep their binary format's special space.
        for ns in ["doom", "heretic", "strife"] {
            assert!(is_teleport_special(39, MapFormat::Udmf, Some(ns)));
            assert!(!is_teleport_special(70, MapFormat::Udmf, Some(ns)));
        }
        for ns in ["hexen", "zdoom"] {
            assert!(is_teleport_special(70, MapFormat::Udmf, Some(ns)));
            assert!(!is_teleport_special(39, MapFormat::Udmf, Some(ns)));
        }
        // An unrecognized or absent namespace classifies nothing rather than
        // guessing: a missing mark is a gap, a wrong one is a lie.
        for ns in [Some("eternity"), Some("vavoom"), Some(""), None] {
            assert!(!is_teleport_special(39, MapFormat::Udmf, ns));
            assert!(!is_teleport_special(70, MapFormat::Udmf, ns));
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

    fn line(
        start: (f64, f64),
        end: (f64, f64),
        special: i32,
        args: [i32; 5],
        sector: Option<usize>,
    ) -> LinkLine {
        LinkLine {
            start,
            end,
            special,
            args,
            id: 0,
            sectors: (sector, None),
        }
    }

    /// A classic pad: four lines around a square, all the same special and tag,
    /// all facing sector 1. The destination is sector 2, tagged 1.
    fn pad_inputs() -> (Vec<LinkLine>, Vec<LinkSector>, Vec<LinkThing>) {
        let lines = vec![
            line((0.0, 0.0), (64.0, 0.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((64.0, 0.0), (64.0, 64.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((64.0, 64.0), (0.0, 64.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((0.0, 64.0), (0.0, 0.0), 97, [1, 0, 0, 0, 0], Some(1)),
            // The destination sector's own boundary — not a teleport source.
            line((200.0, 200.0), (300.0, 200.0), 0, [0; 5], Some(2)),
            line((300.0, 200.0), (300.0, 300.0), 0, [0; 5], Some(2)),
            line((300.0, 300.0), (200.0, 300.0), 0, [0; 5], Some(2)),
            line((200.0, 300.0), (200.0, 200.0), 0, [0; 5], Some(2)),
        ];
        let sectors = vec![
            LinkSector { tag: 0 },
            LinkSector { tag: 0 },
            LinkSector { tag: 1 },
        ];
        (lines, sectors, Vec::new())
    }

    #[test]
    fn a_four_line_pad_yields_one_link_from_its_center() {
        let (lines, sectors, things) = pad_inputs();
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(
            result.len(),
            1,
            "four lines of one pad collapse to one link"
        );
        assert_eq!(result[0].from, [32.0, 32.0], "the pad's center");
        assert_eq!(result[0].to, [250.0, 250.0], "the tagged sector's center");
    }

    #[test]
    fn a_pad_whose_lines_face_outward_still_yields_one_link() {
        // Same pad, but every line's facing sidedef is on the other side. The
        // grouping must not depend on which way the pad's lines face.
        let (mut lines, sectors, things) = pad_inputs();
        for l in lines.iter_mut().take(4) {
            l.sectors = (None, Some(1));
        }
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].from, [32.0, 32.0]);
    }

    #[test]
    fn an_unmatched_or_zero_tag_yields_no_link() {
        let (mut lines, sectors, things) = pad_inputs();
        for l in lines.iter_mut().take(4) {
            l.args = [99, 0, 0, 0, 0]; // no sector carries tag 99
        }
        let unmatched = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert!(unmatched.is_empty(), "an unmatched tag draws nothing");

        for l in lines.iter_mut().take(4) {
            l.args = [0; 5]; // tag 0 is the binary "no tag" value
        }
        let zero = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert!(zero.is_empty(), "tag 0 never matches");
    }

    #[test]
    fn several_sectors_sharing_a_tag_resolve_to_the_lowest_index() {
        let (lines, mut sectors, things) = pad_inputs();
        sectors.push(LinkSector { tag: 1 }); // a second sector tagged 1
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].to, [250.0, 250.0], "sector 2 wins over sector 3");
    }

    #[test]
    fn boom_line_to_line_targets_a_line_by_tag() {
        let lines = vec![
            line((0.0, 0.0), (64.0, 0.0), 243, [7, 0, 0, 0, 0], Some(1)),
            line((100.0, 0.0), (100.0, 100.0), 0, [7, 0, 0, 0, 0], Some(2)),
        ];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].from, [32.0, 0.0], "the source line's midpoint");
        assert_eq!(result[0].to, [100.0, 50.0], "the target line's midpoint");
    }

    #[test]
    fn hexen_teleport_targets_a_thing_by_tid_exactly() {
        let lines = vec![line((0.0, 0.0), (64.0, 0.0), 70, [5, 0, 0, 0, 0], Some(1))];
        let things = vec![
            LinkThing {
                id: 4,
                x: 10.0,
                y: 10.0,
            },
            LinkThing {
                id: 5,
                x: 300.0,
                y: 400.0,
            },
        ];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &[LinkSector { tag: 0 }; 2],
            things: &things,
            format: MapFormat::Hexen,
            namespace: None,
        });
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].to,
            [300.0, 400.0],
            "Hexen names its destination thing, so the link is exact"
        );
    }

    #[test]
    fn hexen_teleport_other_classifies_but_never_links() {
        let lines = vec![line((0.0, 0.0), (64.0, 0.0), 76, [5, 0, 0, 0, 0], Some(1))];
        let things = vec![LinkThing {
            id: 5,
            x: 300.0,
            y: 400.0,
        }];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &[LinkSector { tag: 0 }; 2],
            things: &things,
            format: MapFormat::Hexen,
            namespace: None,
        });
        assert!(
            is_teleport_special(76, MapFormat::Hexen, None),
            "TeleportOther is still a teleport source"
        );
        assert!(
            result.is_empty(),
            "but it relocates another actor, so a source->destination link would misrepresent it"
        );
    }

    #[test]
    fn teleport_line_matches_the_line_id_not_the_tag() {
        // The decoy carries tag 9 in args[0]; the real target carries id 9.
        // An implementation reading the wrong field picks the decoy.
        let mut source = line((0.0, 0.0), (64.0, 0.0), 215, [0, 9, 0, 0, 0], Some(1));
        source.id = 1;
        let mut decoy = line((500.0, 500.0), (600.0, 500.0), 0, [9, 0, 0, 0, 0], Some(2));
        decoy.id = 0;
        let mut target = line((100.0, 0.0), (100.0, 100.0), 0, [0; 5], Some(2));
        target.id = 9;
        let links = build_teleport_links(&LinkInputs {
            lines: &[source, decoy, target],
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Hexen,
            namespace: None,
        });
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].to, [100.0, 50.0], "matched on id, not on args[0]");
    }

    #[test]
    fn tiny_pwad_teleports_have_no_destination() {
        let m = map2d(&tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.lines.iter().filter(|l| l.teleport).count(), 2);
        assert!(
            m.links.is_empty(),
            "its teleport lines are tagged 1 but nothing carries that tag"
        );
    }
}
