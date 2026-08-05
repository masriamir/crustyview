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
