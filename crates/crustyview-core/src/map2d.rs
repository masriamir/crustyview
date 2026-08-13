//! Flatten an assembled map into 2D view geometry.
//!
//! `map2d` is the phase-1 contract behind the browser's top-down map view
//! (ADR-0002 staging): everything the canvas needs, nothing it doesn't.

use crate::assemble::assemble_view;
use crate::error::sanitize;
use crustywad::Wad;
use crustywad::map::{Map, MapFormat, SidedefIdx};
use std::collections::HashMap;

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

/// UDMF namespaces that keep the Doom special number space. `zdoomtranslated`
/// marks a map translated from Hexen-format to UDMF that kept Doom-style
/// special numbering (as opposed to `zdoom`'s native Hexen-style numbering),
/// so it belongs here, not in [`HEXEN_NAMESPACES`].
const DOOM_NAMESPACES: [&str; 4] = ["doom", "heretic", "strife", "zdoomtranslated"];
/// UDMF namespaces that use the Hexen special number space.
const HEXEN_NAMESPACES: [&str; 2] = ["hexen", "zdoom"];

/// Whether `ns` names one of `namespaces`, ignoring ASCII case. crustywad
/// stores a UDMF `namespace` declaration verbatim, but `ZDoom` itself treats
/// it case-insensitively — a map authored with `namespace = "ZDoom";` is
/// common and must classify identically to `"zdoom"` (#66 review).
fn namespace_matches(namespaces: &[&str], ns: &str) -> bool {
    namespaces.iter().any(|n| n.eq_ignore_ascii_case(ns))
}

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
            Some(ns) if namespace_matches(&DOOM_NAMESPACES, ns) => {
                TELEPORT_SPECIALS.contains(&special)
            }
            Some(ns) if namespace_matches(&HEXEN_NAMESPACES, ns) => {
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
/// connected cluster of source lines that share a destination — a pad's four
/// lines touch at their corners and so form one cluster, while two disjoint
/// pads that happen to share a destination tag share no vertices and stay
/// two clusters, so they draw two links rather than collapsing into a single
/// phantom link drawn from a point between them (#66 review).
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
    /// The thing's doomednum. Used to find a teleport landing (type `14`)
    /// when several same-tag sectors are candidates for a `Sector` target.
    pub type_id: u16,
}

/// The vanilla teleport-landing thing type (`Teleportman`, doomednum `14`).
/// `EV_Teleport` searches a tagged sector's things for one of these; a
/// sector without one is not where a working teleporter lands.
const TELEPORT_LANDING_TYPE_ID: u16 = 14;

pub(crate) struct LinkInputs<'a> {
    pub lines: &'a [LinkLine],
    pub sectors: &'a [LinkSector],
    pub things: &'a [LinkThing],
    pub format: MapFormat,
    pub namespace: Option<&'a str>,
}

/// What a teleport source points at, before it is resolved to a point.
#[derive(Debug, PartialEq, Eq, Hash, Clone, Copy)]
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
        || matches!(namespace, Some(ns) if namespace_matches(&DOOM_NAMESPACES, ns));
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

/// The mean of every point in `points`, or `None` when there are none. Used
/// both for a source pad's centroid (a cluster's line endpoints) and, for a
/// sector destination, as the mean of every boundary vertex — a
/// vertex-multiplicity mean, not a true area centroid, so for a concave or
/// donut-shaped sector the result can land outside the sector's floor. That
/// is a known, accepted approximation (#49), not an oversight.
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

/// Every boundary vertex of sector `idx`: the endpoints of every line with a
/// sidedef facing it, either side. No polygon, so the self-referencing-sector
/// problem never arises (#49).
fn sector_points(inp: &LinkInputs, idx: usize) -> Vec<(f64, f64)> {
    inp.lines
        .iter()
        .filter(|l| l.sectors.0 == Some(idx) || l.sectors.1 == Some(idx))
        .flat_map(|l| [l.start, l.end])
        .collect()
}

/// The bounding box (`min_x, min_y, max_x, max_y`) of sector `idx`'s boundary
/// vertices, or `None` when it has none. A cheap superset of "inside the
/// sector" — not point-in-polygon containment, which this module
/// deliberately never computes (#49) — used only to *choose among* several
/// same-tag sector candidates in [`resolve`], so it can only narrow a blind
/// pick, never make one worse.
fn sector_bbox(inp: &LinkInputs, idx: usize) -> Option<(f64, f64, f64, f64)> {
    let points = sector_points(inp, idx);
    if points.is_empty() {
        return None;
    }
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &(x, y) in &points {
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x);
        max_y = max_y.max(y);
    }
    Some((min_x, min_y, max_x, max_y))
}

/// Resolve a target to a point, given every source line in its cluster —
/// all excluded from a linedef search so a teleporter can't resolve to
/// itself or to a sibling line in its own pad. Boom's own `P_FindLine` does
/// a lighter version of this (excluding just the searching line, by index)
/// which matters for a bidirectional pair of line-to-line teleporters: both
/// lines carry the *same* teleport special, so excluding "any other
/// teleport-special line" (as an earlier version of this function did) would
/// wrongly exclude the real target too.
fn resolve(target: LinkTarget, component: &[usize], inp: &LinkInputs) -> Option<[f64; 2]> {
    // Tag/tid `0` is Doom/Hexen's "no tag" sentinel. A UDMF line with no `id`
    // assigned defaults to `-1` (crustywad's documented sentinel for
    // `MapLinedef::id`), so `LineById` guards `<= 0` to catch both. Checked
    // ahead of the match, rather than as a second `None`-returning arm in it,
    // because `clippy::match_same_arms` (a hard error here, `-D warnings`)
    // flags two arms with identical bodies — the same reason
    // [`is_teleport_special`]'s `Doom64 | _` arm is merged.
    let unset = match target {
        LinkTarget::Sector(t) | LinkTarget::LineByTag(t) | LinkTarget::Thing(t) => t == 0,
        LinkTarget::LineById(id) => id <= 0,
    };
    if unset {
        return None;
    }
    match target {
        LinkTarget::Sector(tag) => {
            let candidates: Vec<usize> = inp
                .sectors
                .iter()
                .enumerate()
                .filter_map(|(idx, s)| (s.tag == tag).then_some(idx))
                .collect();
            // Vanilla `EV_Teleport` iterates every sector carrying the tag
            // and teleports to the first one that *contains* a teleport
            // landing (thing type 14) — not simply the lowest-tagged index.
            // Measured on Freedoom: 23 of 64 multi-candidate sources picked
            // a landing-less sector while a later same-tag sector held the
            // landing (#66 review). Falls back to the lowest index when no
            // candidate's bounding box contains one, matching the old
            // behavior exactly in that case.
            let idx = candidates
                .iter()
                .copied()
                .find(|&idx| {
                    sector_bbox(inp, idx).is_some_and(|(min_x, min_y, max_x, max_y)| {
                        inp.things.iter().any(|t| {
                            t.type_id == TELEPORT_LANDING_TYPE_ID
                                && (min_x..=max_x).contains(&t.x)
                                && (min_y..=max_y).contains(&t.y)
                        })
                    })
                })
                .or_else(|| candidates.first().copied())?;
            centroid(&sector_points(inp, idx))
        }
        LinkTarget::LineByTag(tag) => inp
            .lines
            .iter()
            .enumerate()
            .find(|(i, l)| !component.contains(i) && l.args[0] == tag)
            .map(|(_, l)| midpoint(l)),
        LinkTarget::LineById(id) => inp
            .lines
            .iter()
            .enumerate()
            .find(|(i, l)| !component.contains(i) && l.id == id)
            .map(|(_, l)| midpoint(l)),
        LinkTarget::Thing(tid) => inp.things.iter().find(|t| t.id == tid).map(|t| [t.x, t.y]),
    }
}

/// A hashable key for an endpoint: the bit pattern of its two `f64`
/// coordinates. Two lines share an endpoint only when they reference the
/// exact same vertex, so bit-exact equality — not a tolerance — is the right
/// notion of "shared" here; this key only exists to let that exact point
/// live in a [`HashMap`].
fn point_key(p: (f64, f64)) -> (u64, u64) {
    (p.0.to_bits(), p.1.to_bits())
}

/// Partition `idxs` (all indices into `lines`, all sharing one [`LinkTarget`])
/// into connected components: lines that share an endpoint, transitively. A
/// teleporter pad is a closed loop, so its four lines share corners and land
/// in one component; two disjoint pads that happen to share a destination
/// tag share no vertices, so they land in two components rather than
/// collapsing into one link drawn from a point between them (#66 review).
fn connected_components(lines: &[LinkLine], idxs: &[usize]) -> Vec<Vec<usize>> {
    let mut by_point: HashMap<(u64, u64), Vec<usize>> = HashMap::new();
    for &i in idxs {
        let l = &lines[i];
        by_point.entry(point_key(l.start)).or_default().push(i);
        by_point.entry(point_key(l.end)).or_default().push(i);
    }
    let mut visited = vec![false; lines.len()];
    let mut components = Vec::new();
    for &start in idxs {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        let mut component = vec![start];
        let mut stack = vec![start];
        while let Some(i) = stack.pop() {
            let l = &lines[i];
            for point in [point_key(l.start), point_key(l.end)] {
                for &j in by_point.get(&point).into_iter().flatten() {
                    if !visited[j] {
                        visited[j] = true;
                        component.push(j);
                        stack.push(j);
                    }
                }
            }
        }
        components.push(component);
    }
    components
}

/// Build one link per connected cluster of source lines that share a
/// destination. The source point is the centroid of that cluster's line
/// endpoints, so a four-line pad draws a single link from its middle rather
/// than four overlapping ones — and two disjoint pads sharing a destination
/// tag draw two links rather than one phantom link between them.
pub(crate) fn build_teleport_links(inp: &LinkInputs) -> Vec<TeleportLink> {
    // Every source line's index, grouped by what it targets.
    let mut by_target: Vec<(LinkTarget, Vec<usize>)> = Vec::new();
    for (i, l) in inp.lines.iter().enumerate() {
        let Some(target) = link_target(l, inp.format, inp.namespace) else {
            continue;
        };
        match by_target.iter_mut().find(|(t, _)| *t == target) {
            Some((_, idxs)) => idxs.push(i),
            None => by_target.push((target, vec![i])),
        }
    }
    let mut links = Vec::new();
    for (target, idxs) in by_target {
        for component in connected_components(inp.lines, &idxs) {
            // The whole cluster is excluded from the linedef search in
            // `resolve`, not just one representative member — every line in
            // it describes the same physical source pad, so none of them is
            // a valid target for the others.
            let Some(to) = resolve(target, &component, inp) else {
                continue;
            };
            let points: Vec<(f64, f64)> = component
                .iter()
                .flat_map(|&i| [inp.lines[i].start, inp.lines[i].end])
                .collect();
            let Some(from) = centroid(&points) else {
                continue;
            };
            links.push(TeleportLink { from, to });
        }
    }
    links
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
            type_id: t.type_id,
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
    use crate::fixtures::{broken_pwad, build_pwad, dangling_blockmap_pwad, name8, tiny_pwad};

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

    /// A PWAD with a *working* teleporter: a four-line pad (special 97,
    /// tag 1) facing a plain room (sector 0), linking to sector 1 (also
    /// tag 1), which is its own boundary. Every other link test hand-builds
    /// `LinkLine`s directly, so this is the only thing that exercises
    /// `teleport_links_for`'s wiring of `l.special.args`, `l.id`, and
    /// `l.right`/`l.left` end to end through `map2d()` (#66 review) —
    /// `tiny_pwad_teleports_have_no_destination` only proves the pipeline is
    /// *reached*, not that it wires the right fields.
    fn teleporter_pwad() -> Wad {
        let vertexes: Vec<u8> = [
            (0i16, 0i16),
            (64, 0),
            (64, 64),
            (0, 64),
            (200, 200),
            (300, 200),
            (300, 300),
            (200, 300),
        ]
        .iter()
        .flat_map(|(x, y)| [x.to_le_bytes(), y.to_le_bytes()].concat())
        .collect();
        // LINEDEFS: start, end, flags, special, tag, right sidedef, left sidedef (7 × u16)
        let linedefs: Vec<u8> = [
            [0u16, 1, 0, 97, 1, 0, 0xFFFF], // pad edge (teleport source)
            [1u16, 2, 0, 97, 1, 0, 0xFFFF],
            [2u16, 3, 0, 97, 1, 0, 0xFFFF],
            [3u16, 0, 0, 97, 1, 0, 0xFFFF],
            [4u16, 5, 0, 0, 0, 1, 0xFFFF], // destination sector's own boundary
            [5u16, 6, 0, 0, 0, 1, 0xFFFF],
            [6u16, 7, 0, 0, 0, 1, 0xFFFF],
            [7u16, 4, 0, 0, 0, 1, 0xFFFF],
        ]
        .iter()
        .flat_map(|r| r.iter().flat_map(|v| v.to_le_bytes()).collect::<Vec<u8>>())
        .collect();
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
        let sidedefs: Vec<u8> = [sidedef(0), sidedef(1)].concat();
        let sector = |tag: u16| {
            let mut b = Vec::new();
            b.extend_from_slice(&0i16.to_le_bytes());
            b.extend_from_slice(&128i16.to_le_bytes());
            b.extend_from_slice(&name8("FLOOR0_1"));
            b.extend_from_slice(&name8("CEIL1_1"));
            for v in [160u16, 0, tag] {
                b.extend_from_slice(&v.to_le_bytes());
            }
            b
        };
        let sectors: Vec<u8> = [sector(0), sector(1)].concat();
        build_pwad(&[
            ("MAP01", &[]),
            ("THINGS", &[]),
            ("LINEDEFS", &linedefs),
            ("SIDEDEFS", &sidedefs),
            ("VERTEXES", &vertexes),
            ("SECTORS", &sectors),
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
    fn every_doom_teleport_special_names_a_destination_kind() {
        // Nothing else catches a special added to `TELEPORT_SPECIALS` without
        // a matching entry in `DOOM_SECTOR_TELEPORTS` or
        // `DOOM_LINE_TELEPORTS`: `link_target` would silently return `None`
        // for it — no compile error, no lint, no failing test until this one
        // (#66 review).
        for s in TELEPORT_SPECIALS {
            assert!(
                DOOM_SECTOR_TELEPORTS.contains(&s) || DOOM_LINE_TELEPORTS.contains(&s),
                "special {s} is classified as a teleport but names no destination kind"
            );
        }
    }

    #[test]
    fn each_teleport_special_maps_to_its_expected_link_target() {
        // `every_doom_teleport_special_names_a_destination_kind` only checks
        // membership in *some* destination-kind list — it cannot catch a
        // special moved to the *wrong* list, or `71` silently dropped from
        // the `70 | 71` Hexen arm, both of which would leave every existing
        // check green (#66 review: only 97/243/70/76/215 of the 20 Doom
        // specials + 3 Hexen ones were ever exercised through
        // `link_target`). This pins the exact `LinkTarget` — variant and
        // which `args` index it reads — for every one, using hardcoded
        // tables rather than the module's own constants, so a constant
        // change can't make the test agree with itself.
        let doom_sector_teleports = [39, 97, 125, 126, 174, 195, 207, 208, 209, 210, 268, 269];
        for special in doom_sector_teleports {
            let l = line((0.0, 0.0), (1.0, 0.0), special, [7, 0, 0, 0, 0], None);
            assert_eq!(
                link_target(&l, MapFormat::Doom, None),
                Some(LinkTarget::Sector(7)),
                "special {special} should target a sector by args[0]"
            );
        }
        let doom_line_teleports = [243, 244, 262, 263, 264, 265, 266, 267];
        for special in doom_line_teleports {
            let l = line((0.0, 0.0), (1.0, 0.0), special, [7, 0, 0, 0, 0], None);
            assert_eq!(
                link_target(&l, MapFormat::Doom, None),
                Some(LinkTarget::LineByTag(7)),
                "special {special} should target a linedef by args[0]"
            );
        }
        // The two tables above must cover exactly `TELEPORT_SPECIALS` — no
        // more, no less — or a special was added to one without a case here.
        let mut covered: Vec<i32> = doom_sector_teleports
            .into_iter()
            .chain(doom_line_teleports)
            .collect();
        covered.sort_unstable();
        let mut expected = TELEPORT_SPECIALS;
        expected.sort_unstable();
        assert_eq!(covered, expected.to_vec());

        for special in [70, 71] {
            let l = line((0.0, 0.0), (1.0, 0.0), special, [7, 0, 0, 0, 0], None);
            assert_eq!(
                link_target(&l, MapFormat::Hexen, None),
                Some(LinkTarget::Thing(7)),
                "special {special} should target a thing by args[0]"
            );
        }
        let teleport_other = line((0.0, 0.0), (1.0, 0.0), 76, [7, 0, 0, 0, 0], None);
        assert_eq!(
            link_target(&teleport_other, MapFormat::Hexen, None),
            None,
            "76 TeleportOther classifies but never yields a link target"
        );
        let by_id = line((0.0, 0.0), (1.0, 0.0), 215, [3, 7, 0, 0, 0], None);
        assert_eq!(
            link_target(&by_id, MapFormat::Hexen, None),
            Some(LinkTarget::LineById(7)),
            "215 should target a linedef by args[1], not args[0]"
        );
    }

    #[test]
    fn udmf_classifies_by_namespace() {
        // The base namespaces keep their binary format's special space —
        // matched case-insensitively (crustywad stores the UDMF `namespace`
        // declaration verbatim, but ZDoom itself does not care about its
        // case), and `zdoomtranslated` keeps Doom-style numbering too (#66
        // review).
        for ns in [
            "doom",
            "heretic",
            "strife",
            "zdoomtranslated",
            "DOOM",
            "ZDoomTranslated",
        ] {
            assert!(is_teleport_special(39, MapFormat::Udmf, Some(ns)), "{ns}");
            assert!(!is_teleport_special(70, MapFormat::Udmf, Some(ns)), "{ns}");
        }
        for ns in ["hexen", "zdoom", "HEXEN", "ZDoom"] {
            assert!(is_teleport_special(70, MapFormat::Udmf, Some(ns)), "{ns}");
            assert!(!is_teleport_special(39, MapFormat::Udmf, Some(ns)), "{ns}");
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
    fn two_disjoint_pads_sharing_a_sector_and_destination_yield_two_links() {
        // Two physically separate pads, same special/tag, both facing the
        // same source sector, both aimed at the same destination. Grouping
        // by (destination, source sector) alone would merge them into one
        // link from the midpoint between the two pads, where no teleporter
        // exists (#66 review) — grouping must instead cluster by shared
        // geometry, so this must yield two links, not one phantom one.
        let (mut lines, sectors, things) = pad_inputs();
        lines.extend([
            line((1000.0, 0.0), (1064.0, 0.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((1064.0, 0.0), (1064.0, 64.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((1064.0, 64.0), (1000.0, 64.0), 97, [1, 0, 0, 0, 0], Some(1)),
            line((1000.0, 64.0), (1000.0, 0.0), 97, [1, 0, 0, 0, 0], Some(1)),
        ]);
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(
            result.len(),
            2,
            "two disjoint pads must not collapse into one link"
        );
        let froms: Vec<[f64; 2]> = result.iter().map(|l| l.from).collect();
        assert!(froms.contains(&[32.0, 32.0]), "the first pad's own center");
        assert!(
            froms.contains(&[1032.0, 32.0]),
            "the second pad's own center, not a point between the two pads"
        );
        assert!(
            result.iter().all(|l| l.to == [250.0, 250.0]),
            "both pads share the same destination"
        );
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
    fn a_tagged_sector_with_no_boundary_lines_yields_no_link() {
        // A sector can carry a teleport's tag while no linedef faces it — a
        // malformed or orphaned tag. There is then no geometry to aim at, so
        // both `sector_bbox` (the landing preference) and `centroid` (the
        // fallback) find no points and the source draws nothing rather than
        // guessing at a position.
        let (mut lines, mut sectors, things) = pad_inputs();
        lines.truncate(4); // drop the destination sector's boundary lines
        sectors.truncate(3); // sector 2 keeps tag 1, but nothing faces it now
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert!(
            result.is_empty(),
            "a tag matching a sector with no geometry draws nothing"
        );
    }

    #[test]
    fn several_sectors_sharing_a_tag_resolve_to_the_lowest_index() {
        // No candidate sector's bounding box contains a teleport landing
        // (thing 14), so this exercises the fallback path — lowest index
        // wins, exactly as it always did before the landing-aware tie-break
        // in `same_tag_sectors_prefer_the_one_containing_a_teleport_landing`.
        let (mut lines, mut sectors, things) = pad_inputs();
        sectors.push(LinkSector { tag: 1 }); // a second sector (index 3) tagged 1
        // Give the decoy sector real boundary geometry, far from sector 2's,
        // so a wrong ("highest index wins") implementation would resolve to
        // a visibly different point rather than merely fail to find one —
        // an empty decoy sector would make this test pass by producing no
        // link at all instead of discriminating on position.
        lines.extend([
            line((1000.0, 1000.0), (1100.0, 1000.0), 0, [0; 5], Some(3)),
            line((1100.0, 1000.0), (1100.0, 1100.0), 0, [0; 5], Some(3)),
            line((1100.0, 1100.0), (1000.0, 1100.0), 0, [0; 5], Some(3)),
            line((1000.0, 1100.0), (1000.0, 1000.0), 0, [0; 5], Some(3)),
        ]);
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
    fn same_tag_sectors_prefer_the_one_containing_a_teleport_landing() {
        // Sectors 2 and 3 share tag 1; only sector 3 contains a thing 14
        // (a teleport landing). Vanilla `EV_Teleport` searches tagged
        // sectors for the first one *containing* a landing, not simply the
        // lowest-tagged index — measured on Freedoom: 23 of 64
        // multi-candidate sources picked a landing-less sector while a
        // later same-tag sector held the landing (#66 review).
        let (mut lines, mut sectors, _) = pad_inputs();
        sectors.push(LinkSector { tag: 1 }); // sector 3, also tagged 1
        lines.extend([
            line((1000.0, 1000.0), (1100.0, 1000.0), 0, [0; 5], Some(3)),
            line((1100.0, 1000.0), (1100.0, 1100.0), 0, [0; 5], Some(3)),
            line((1100.0, 1100.0), (1000.0, 1100.0), 0, [0; 5], Some(3)),
            line((1000.0, 1100.0), (1000.0, 1000.0), 0, [0; 5], Some(3)),
        ]);
        let things = vec![LinkThing {
            id: 1,
            x: 1050.0,
            y: 1050.0,
            type_id: 14,
        }];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &sectors,
            things: &things,
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(result.len(), 1);
        assert_eq!(
            result[0].to,
            [1050.0, 1050.0],
            "sector 3 contains the landing; sector 2 does not, despite the lower index"
        );
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
    fn a_bidirectional_boom_line_pair_yields_two_links() {
        // The idiomatic two-way Boom line teleporter: both lines carry the
        // *same* teleport special and the same tag, each naming the other as
        // its destination. Excluding "any other teleport-special line" from
        // candidacy (as an earlier version of `resolve` did) would exclude
        // the real target too, since it is itself a 243 line.
        let lines = vec![
            line((0.0, 0.0), (64.0, 0.0), 243, [7, 0, 0, 0, 0], Some(1)),
            line((100.0, 0.0), (100.0, 100.0), 243, [7, 0, 0, 0, 0], Some(2)),
        ];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(
            result.len(),
            2,
            "each line is its own source, targeting the other"
        );
        assert!(
            result
                .iter()
                .any(|l| l.from == [32.0, 0.0] && l.to == [100.0, 50.0]),
            "line 1 points at line 2's midpoint"
        );
        assert!(
            result
                .iter()
                .any(|l| l.from == [100.0, 50.0] && l.to == [32.0, 0.0]),
            "line 2 points at line 1's midpoint"
        );
    }

    #[test]
    fn a_connected_multi_line_source_never_resolves_to_its_own_sibling() {
        // Two lines that share an endpoint — one connected source cluster —
        // both carrying tag 7, plus a separate real target line elsewhere
        // also tagged 7. Excluding only one representative line (as an
        // earlier version of `resolve` did, via `component.first()`) leaves
        // every *other* member of the same cluster as a valid candidate, so
        // the first line could resolve to its own sibling — a link from the
        // pad to itself (#66 review).
        let lines = vec![
            line((0.0, 0.0), (64.0, 0.0), 243, [7, 0, 0, 0, 0], Some(1)), // idx 0
            line((64.0, 0.0), (64.0, 64.0), 243, [7, 0, 0, 0, 0], Some(1)), // idx 1, shares (64,0) with idx 0
            line((500.0, 0.0), (500.0, 100.0), 0, [7, 0, 0, 0, 0], Some(2)), // idx 2, the real target
        ];
        let result = build_teleport_links(&LinkInputs {
            lines: &lines,
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Doom,
            namespace: None,
        });
        assert_eq!(result.len(), 1, "one cluster, one link");
        assert_eq!(
            result[0].to,
            [500.0, 50.0],
            "must resolve to the real target line, not a sibling in its own cluster"
        );
    }

    #[test]
    fn hexen_teleport_targets_a_thing_by_tid_exactly() {
        let lines = vec![line((0.0, 0.0), (64.0, 0.0), 70, [5, 0, 0, 0, 0], Some(1))];
        let things = vec![
            LinkThing {
                id: 4,
                x: 10.0,
                y: 10.0,
                type_id: 0,
            },
            LinkThing {
                id: 5,
                x: 300.0,
                y: 400.0,
                type_id: 0,
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
            type_id: 0,
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
        //
        // Format is UDMF/zdoom, not binary Hexen: crustywad assembles every
        // binary Hexen/Doom linedef with `id = 0` (there is no on-disk line
        // id field to read), so special 215 can never functionally match on
        // a real *binary* Hexen map — only on UDMF's `hexen`/`zdoom`
        // namespaces, where `id` is an actual per-line UDMF field. Testing
        // this under `MapFormat::Hexen` with hand-set ids exercised a
        // configuration the real assembly pipeline cannot produce (#66
        // review).
        // `args[0]` is deliberately a *live* id (7) rather than 0, and a decoy
        // line carries that id. An earlier version left it 0, so a mutant
        // reading `args[0]` hit the "unset" guard and produced no link at all —
        // the test still failed, but on emptiness rather than on following the
        // wrong field. With a live decoy it fails on a wrong *coordinate*,
        // which is what the name claims.
        let mut source = line((0.0, 0.0), (64.0, 0.0), 215, [7, 9, 0, 0, 0], Some(1));
        source.id = 1;
        let mut decoy = line((500.0, 500.0), (600.0, 500.0), 0, [0; 5], Some(2));
        decoy.id = 7;
        let mut target = line((100.0, 0.0), (100.0, 100.0), 0, [0; 5], Some(2));
        target.id = 9;
        let links = build_teleport_links(&LinkInputs {
            lines: &[source, decoy, target],
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Udmf,
            namespace: Some("zdoom"),
        });
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].to, [100.0, 50.0], "matched on id, not on args[0]");
    }

    #[test]
    fn a_line_id_target_never_resolves_to_the_source_line_itself() {
        // A malformed UDMF/zdoom map where a teleport line's own id happens
        // to equal the id it targets. The source-index exclusion (not a
        // special-based one — see `resolve`'s doc comment) must stop it
        // linking to itself; the only candidate line here IS the source.
        let mut source = line((0.0, 0.0), (64.0, 0.0), 215, [0, 5, 0, 0, 0], Some(1));
        source.id = 5;
        let result = build_teleport_links(&LinkInputs {
            lines: &[source],
            sectors: &[LinkSector { tag: 0 }],
            things: &[],
            format: MapFormat::Udmf,
            namespace: Some("zdoom"),
        });
        assert!(
            result.is_empty(),
            "the only line carrying id 5 is the source itself"
        );
    }

    #[test]
    fn udmf_no_id_sentinel_never_matches_via_line_id() {
        // crustywad documents UDMF's "no id" sentinel as -1 (Doom/Hexen's is
        // 0), and every UDMF line that omits `id` gets that same -1 — so two
        // id-less lines must never link to each other via special 215.
        let mut source = line((0.0, 0.0), (64.0, 0.0), 215, [0, -1, 0, 0, 0], Some(1));
        source.id = -1;
        let mut other = line((100.0, 0.0), (100.0, 100.0), 0, [0; 5], Some(2));
        other.id = -1;
        let result = build_teleport_links(&LinkInputs {
            lines: &[source, other],
            sectors: &[LinkSector { tag: 0 }; 3],
            things: &[],
            format: MapFormat::Udmf,
            namespace: Some("zdoom"),
        });
        assert!(
            result.is_empty(),
            "-1 is UDMF's unset sentinel, not a real shared id"
        );
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

    #[test]
    fn a_real_teleporter_produces_one_link_through_the_full_pipeline() {
        let m = map2d(&teleporter_pwad(), "MAP01").expect("assembles");
        assert_eq!(m.links.len(), 1);
        assert_eq!(m.links[0].from, [32.0, 32.0], "the pad's own center");
        assert_eq!(
            m.links[0].to,
            [250.0, 250.0],
            "the tagged destination sector's center"
        );
    }

    #[test]
    fn links_field_skips_empty_and_appears_when_populated() {
        // `sector_fields_skip_false_in_json` is the precedent: nothing else
        // pins the serialized shape of `links`, so renaming the field or
        // dropping its `#[serde(skip_serializing_if)]` would keep every
        // other check green while silently breaking `format.ts` (#66
        // review).
        let empty = map2d(&tiny_pwad(), "MAP01").unwrap();
        let empty_json = serde_json::to_string(&empty).unwrap();
        assert!(
            !empty_json.contains("\"links\""),
            "an empty links vec is omitted from the payload"
        );

        let populated = map2d(&teleporter_pwad(), "MAP01").unwrap();
        let populated_json = serde_json::to_string(&populated).unwrap();
        assert!(
            populated_json.contains("\"links\":["),
            "a populated links vec is serialized under the `links` key"
        );
        assert!(
            populated_json.contains("\"from\":[32.0,32.0]")
                && populated_json.contains("\"to\":[250.0,250.0]"),
            "each link keeps its `from`/`to` shape: {populated_json}"
        );
    }
}
