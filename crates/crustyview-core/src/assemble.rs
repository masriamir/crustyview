//! Assembling map groups the way the 2D viewer needs them.

use crustywad::Wad;
use crustywad::map::{Map, MapAssembleError, MapGroup};

/// Optional lumps the 2D viewer never reads. Filtering them out of a map
/// group lets everything the viewer *does* consume stay under full strict
/// validation, even when these lumps are defective (#45; crustywad ADR-0029 /
/// crustywad#422). Absent `BLOCKMAP`/`REJECT` decode to `None` with no error
/// and no warning in either strictness mode.
pub const VIEWER_SKIPPED_LUMPS: [&str; 2] = ["BLOCKMAP", "REJECT"];

/// Assemble `group` for viewing: strict validation, minus the lumps in
/// [`VIEWER_SKIPPED_LUMPS`].
///
/// Preferred over lenient assembly, which would also mask defects in the
/// geometry the viewer does consume.
///
/// # Errors
///
/// Propagates crustywad's [`MapAssembleError`] for any defect in the lumps
/// the viewer actually reads.
pub fn assemble_view(wad: &Wad, group: &MapGroup) -> Result<Map, MapAssembleError> {
    Map::assemble(wad, &group.without_lumps(wad, &VIEWER_SKIPPED_LUMPS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::{broken_pwad, dangling_blockmap_pwad};

    fn first_group(wad: &Wad) -> MapGroup {
        wad.map_groups().into_iter().next().expect("a map group")
    }

    #[test]
    fn strict_assembly_rejects_a_dangling_blockmap_reference() {
        let wad = dangling_blockmap_pwad();
        let err = Map::assemble(&wad, &first_group(&wad)).expect_err("strict must reject");
        assert_eq!(
            err.to_string(),
            "linedef index 999 referenced from blockmap block is out of range (1 available)"
        );
    }

    #[test]
    fn assemble_view_skips_the_defective_blockmap() {
        let wad = dangling_blockmap_pwad();
        let map = assemble_view(&wad, &first_group(&wad)).expect("blockmap is not the viewer's");
        assert_eq!(map.linedefs().len(), 1);
        assert!(
            map.blockmap().is_none(),
            "the filtered lump decodes to None"
        );
    }

    #[test]
    fn assemble_view_still_propagates_real_defects() {
        // A missing VERTEXES lump is geometry the viewer does read.
        let wad = broken_pwad();
        assert!(assemble_view(&wad, &first_group(&wad)).is_err());
    }
}
