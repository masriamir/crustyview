//! Map and texture probes exercising crustywad's heavier read paths.

use crustywad::gfx::GfxError;
use crustywad::map::Map;
use crustywad::{ParseOptions, Wad};

/// Summary counts from assembling the first map group.
#[derive(Debug, Clone, serde::Serialize)]
pub struct MapProbe {
    /// The assembled map's name.
    pub name: String,
    /// Vertex count.
    pub vertices: usize,
    /// Linedef count.
    pub linedefs: usize,
    /// Sidedef count.
    pub sidedefs: usize,
    /// Sector count.
    pub sectors: usize,
    /// Thing count.
    pub things: usize,
}

/// Assemble the first map group and report its element counts.
///
/// Returns `None` when there is no map group or assembly fails.
#[must_use]
pub fn probe_first_map(wad: &Wad) -> Option<MapProbe> {
    let group = wad.map_groups().into_iter().next()?;
    let map = Map::assemble(wad, &group).ok()?;
    Some(MapProbe {
        name: map.name().to_owned(),
        vertices: map.vertices().len(),
        linedefs: map.linedefs().len(),
        sidedefs: map.sidedefs().len(),
        sectors: map.sectors().len(),
        things: map.things().len(),
    })
}

/// The first composited texture: name, dimensions, and RGBA pixels.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TextureProbe {
    /// The texture's name.
    pub name: String,
    /// Canvas width in pixels.
    pub width: u16,
    /// Canvas height in pixels.
    pub height: u16,
    /// RGBA pixels, `width * height * 4` bytes (not serialized).
    #[serde(skip)]
    pub rgba: Vec<u8>,
}

/// Composite the first texture in `TEXTURE1`/`TEXTURE2` using the first palette.
///
/// Returns `Ok(None)` when the WAD has no texture set, no textures, or no palette.
///
/// # Errors
///
/// Returns [`GfxError`] if parsing the texture set, palette, or compositing fails.
pub fn probe_first_texture(wad: &Wad) -> Result<Option<TextureProbe>, GfxError> {
    let Some(set) = wad.texture_set()? else {
        return Ok(None);
    };
    let Some(name) = set.textures().first().map(|t| t.name.clone()) else {
        return Ok(None);
    };
    let Some(playpal) = wad.playpal()? else {
        return Ok(None);
    };
    let Some(palette) = playpal.palettes().first() else {
        return Ok(None);
    };
    let (image, _warnings) = set.compose_rgba(0, &ParseOptions::default(), palette)?;
    Ok(Some(TextureProbe {
        name,
        width: image.width,
        height: image.height,
        rgba: image.pixels,
    }))
}

/// First texture's name and dimensions, without compositing pixels.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TextureMeta {
    /// The texture's name.
    pub name: String,
    /// Canvas width in pixels.
    pub width: u16,
    /// Canvas height in pixels.
    pub height: u16,
}

/// Name + dimensions of the first texture, read from its `TextureDef` (no compositing).
///
/// # Errors
///
/// Returns [`GfxError`] if parsing the texture set fails.
pub fn probe_first_texture_meta(wad: &Wad) -> Result<Option<TextureMeta>, GfxError> {
    let Some(set) = wad.texture_set()? else {
        return Ok(None);
    };
    let Some(def) = set.textures().first() else {
        return Ok(None);
    };
    // Treat non-representable (negative/corrupt) dimensions as "no usable
    // texture" rather than reporting a misleading 0×0.
    let (Ok(width), Ok(height)) = (u16::try_from(def.width), u16::try_from(def.height)) else {
        return Ok(None);
    };
    Ok(Some(TextureMeta {
        name: def.name.clone(),
        width,
        height,
    }))
}

/// Record counts for one assembled map, keyed by the classic lump names.
///
/// Counts come from the assembled arenas — format-agnostic, and they report
/// what the viewer models: lenient-mode recovery can drop dangling records,
/// so a count can differ from the raw lump's record tally on broken maps.
/// Maps without BSP lumps report `segs`/`subsectors`/`nodes` as 0.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct MapStats {
    /// THINGS records.
    pub things: usize,
    /// VERTEXES records.
    pub vertexes: usize,
    /// LINEDEFS records.
    pub linedefs: usize,
    /// SIDEDEFS records.
    pub sidedefs: usize,
    /// SECTORS records.
    pub sectors: usize,
    /// SEGS records (0 without BSP lumps).
    pub segs: usize,
    /// SSECTORS records (0 without BSP lumps).
    pub subsectors: usize,
    /// NODES records (0 without BSP lumps).
    pub nodes: usize,
}

/// Counts from the named map's assembled arenas, or `None` when no group has
/// that name or assembly fails — best-effort like the other probes; the map
/// view's alert owns failure messaging (#46).
#[must_use]
pub fn map_stats(wad: &Wad, name: &str) -> Option<MapStats> {
    let group = wad.map_groups().into_iter().find(|g| g.name == name)?;
    let map = Map::assemble(wad, &group).ok()?;
    Some(MapStats {
        things: map.things().len(),
        vertexes: map.vertices().len(),
        linedefs: map.linedefs().len(),
        sidedefs: map.sidedefs().len(),
        sectors: map.sectors().len(),
        segs: map.segs().len(),
        subsectors: map.subsectors().len(),
        nodes: map.nodes().len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_stats_counts_the_assembled_arenas() {
        let stats = map_stats(&crate::fixtures::tiny_pwad(), "MAP01").expect("assembles");
        assert_eq!(stats.things, 2);
        assert_eq!(stats.vertexes, 3);
        assert_eq!(stats.linedefs, 8);
        assert_eq!(stats.sidedefs, 5);
        assert_eq!(stats.sectors, 4);
        assert_eq!(
            (stats.segs, stats.subsectors, stats.nodes),
            (0, 0, 0),
            "no BSP lumps"
        );
    }

    #[test]
    fn map_stats_is_none_for_missing_or_broken_maps() {
        assert!(map_stats(&crate::fixtures::tiny_pwad(), "MAP99").is_none());
        assert!(map_stats(&crate::fixtures::broken_pwad(), "MAP01").is_none());
    }

    #[test]
    fn map_stats_serializes_snake_case() {
        let stats = map_stats(&crate::fixtures::tiny_pwad(), "MAP01").unwrap();
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("\"vertexes\":3"));
        assert!(json.contains("\"subsectors\":0"));
    }
}
