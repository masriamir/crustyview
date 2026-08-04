//! WAD summarization (native-testable).

use crustywad::{ParseError, Wad, WadKind};

/// A high-level summary of a WAD's contents.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct WadSummary {
    /// Container kind: `"IWAD"`, `"PWAD"`, or `"Unknown"`.
    pub kind: String,
    /// Total number of lumps in the directory.
    pub lump_count: usize,
    /// Number of detected map groups.
    pub map_count: usize,
    /// Name of the first map group, if any.
    pub first_map: Option<String>,
    /// Detected game (debug form), if crustywad could infer one.
    pub game: Option<String>,
}

/// Parse `bytes` as a WAD and summarize it.
///
/// # Errors
///
/// Returns [`ParseError`] when `bytes` are not a valid WAD.
pub fn summarize(bytes: impl Into<Vec<u8>>) -> Result<WadSummary, ParseError> {
    let wad = Wad::from_bytes(bytes)?;
    let groups = wad.map_groups();
    let kind = match wad.kind() {
        WadKind::Iwad => "IWAD",
        WadKind::Pwad => "PWAD",
        WadKind::Unknown(_) => "Unknown",
    };
    Ok(WadSummary {
        kind: kind.to_owned(),
        lump_count: wad.lump_count(),
        map_count: groups.len(),
        first_map: groups.first().map(|g| g.name.clone()),
        game: wad.detect_game().map(|g| format!("{g:?}")),
    })
}
