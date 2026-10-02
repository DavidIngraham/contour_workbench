#![warn(missing_docs)]
//! Browser boundary for Contour Workbench's Rust geometry core.
//!
//! A session owns the elevation grid so repeated overlay and model builds do not
//! resend or reparse the largest project object. Geometry is returned in the
//! versioned `CWB1` packet format: JSON metadata followed by aligned
//! `f32` positions and `u32` triangle indices.

use contour_core::*;
use serde::Serialize;
use wasm_bindgen::prelude::*;

const PACKET_MAGIC: u32 = u32::from_le_bytes(*b"CWB1");

fn err(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn push_u32(out: &mut Vec<u8>, value: usize) -> Result<(), JsValue> {
    let value = u32::try_from(value).map_err(|_| err("Mesh packet exceeds 32-bit limits"))?;
    out.extend_from_slice(&value.to_le_bytes());
    Ok(())
}

fn encode_packet<T: Serialize>(metadata: &T, meshes: &[&Mesh]) -> Result<Vec<u8>, JsValue> {
    let metadata = serde_json::to_vec(metadata).map_err(err)?;
    let table_bytes = meshes
        .len()
        .checked_mul(8)
        .ok_or_else(|| err("Mesh packet table is too large"))?;
    let mesh_bytes = meshes.iter().try_fold(0usize, |total, mesh| {
        let values = mesh
            .positions
            .len()
            .checked_add(mesh.indices.len())
            .and_then(|count| count.checked_mul(4))
            .ok_or_else(|| err("Mesh packet is too large"))?;
        total
            .checked_add(values)
            .ok_or_else(|| err("Mesh packet is too large"))
    })?;
    let metadata_padding = (4 - metadata.len() % 4) % 4;
    let capacity = 12usize
        .checked_add(table_bytes)
        .and_then(|n| n.checked_add(metadata.len()))
        .and_then(|n| n.checked_add(metadata_padding))
        .and_then(|n| n.checked_add(mesh_bytes))
        .ok_or_else(|| err("Mesh packet is too large"))?;
    let mut out = Vec::with_capacity(capacity);
    out.extend_from_slice(&PACKET_MAGIC.to_le_bytes());
    push_u32(&mut out, metadata.len())?;
    push_u32(&mut out, meshes.len())?;
    for mesh in meshes {
        push_u32(&mut out, mesh.positions.len())?;
        push_u32(&mut out, mesh.indices.len())?;
    }
    out.extend_from_slice(&metadata);
    out.resize(out.len() + metadata_padding, 0);
    for mesh in meshes {
        for &position in &mesh.positions {
            out.extend_from_slice(&(position as f32).to_le_bytes());
        }
        for &index in &mesh.indices {
            out.extend_from_slice(&index.to_le_bytes());
        }
    }
    Ok(out)
}

#[derive(Serialize)]
struct TerrainMetadata<'a> {
    layout: &'a Layout,
    source_samples: usize,
    retained_samples: usize,
}

#[derive(Serialize)]
struct OverlayMetadata<'a> {
    treatment: Treatment,
    id: &'a str,
    class: &'a str,
}

#[derive(Serialize)]
struct PieceMetadata<'a> {
    id: &'a str,
    class: &'a str,
    origin: [f64; 3],
    insert_depth_mm: f64,
    conformal: bool,
}

#[derive(Serialize)]
struct PlanMetadata<'a> {
    inserts: Vec<PieceMetadata<'a>>,
    cutter_group_ends: &'a [usize],
    removed_terrain_islands: usize,
}

/// Stateful browser geometry session that owns one validated elevation grid.
#[wasm_bindgen]
pub struct TerrainSession {
    grid: Grid,
}

#[wasm_bindgen]
impl TerrainSession {
    /// Parse and validate an elevation grid, then create a reusable session.
    #[wasm_bindgen(constructor)]
    pub fn new(grid: &str) -> Result<TerrainSession, JsValue> {
        let grid: Grid = serde_json::from_str(grid).map_err(err)?;
        grid.validate().map_err(err)?;
        Ok(Self { grid })
    }

    /// Build terrain and return one packed mesh plus layout metadata.
    pub fn build_terrain(&self, settings: &str) -> Result<Vec<u8>, JsValue> {
        let settings: Settings = serde_json::from_str(settings).map_err(err)?;
        let terrain = terrain(&self.grid, &settings).map_err(err)?;
        let metadata = TerrainMetadata {
            layout: &terrain.layout,
            source_samples: terrain.source_samples,
            retained_samples: terrain.retained_samples,
        };
        encode_packet(&metadata, &[&terrain.mesh])
    }

    /// Build lightweight feature previews and return a packed mesh packet.
    pub fn build_overlays(
        &self,
        settings: &str,
        features: &str,
        layout: &str,
    ) -> Result<Vec<u8>, JsValue> {
        let settings: Settings = serde_json::from_str(settings).map_err(err)?;
        let features: Vec<Feature> = serde_json::from_str(features).map_err(err)?;
        let layout: Layout = serde_json::from_str(layout).map_err(err)?;
        let overlays = overlays(&self.grid, &settings, &features, &layout).map_err(err)?;
        let metadata: Vec<_> = overlays
            .iter()
            .map(|overlay| OverlayMetadata {
                treatment: overlay.treatment,
                id: &overlay.id,
                class: &overlay.class,
            })
            .collect();
        let meshes: Vec<_> = overlays.iter().map(|overlay| &overlay.mesh).collect();
        encode_packet(&metadata, &meshes)
    }

    /// Build insert and cutter geometry for the browser solid-boolean stage.
    pub fn build_plan(
        &self,
        settings: &str,
        features: &str,
        layout: &str,
    ) -> Result<Vec<u8>, JsValue> {
        let settings: Settings = serde_json::from_str(settings).map_err(err)?;
        let features: Vec<Feature> = serde_json::from_str(features).map_err(err)?;
        let layout: Layout = serde_json::from_str(layout).map_err(err)?;
        let plan = plan(&self.grid, &settings, &features, &layout).map_err(err)?;
        let metadata = PlanMetadata {
            inserts: plan
                .inserts
                .iter()
                .map(|piece| PieceMetadata {
                    id: &piece.id,
                    class: &piece.class,
                    origin: piece.origin,
                    insert_depth_mm: piece.insert_depth_mm,
                    conformal: piece.conformal,
                })
                .collect(),
            cutter_group_ends: &plan.cutter_group_ends,
            removed_terrain_islands: plan.removed_terrain_islands,
        };
        let mut meshes: Vec<_> = plan.inserts.iter().map(|piece| &piece.mesh).collect();
        meshes.extend(plan.cutters.iter());
        encode_packet(&metadata, &meshes)
    }
}

/// Normalize Overpass JSON or GeoJSON into supported features.
#[wasm_bindgen]
pub fn classify_features(input: &str) -> Result<String, JsValue> {
    let value = serde_json::from_str(input).map_err(err)?;
    serde_json::to_string(&normalize(&value)).map_err(err)
}

/// Return Copernicus tile URLs covering serialized geographic bounds.
#[wasm_bindgen]
pub fn source_urls(bounds: &str, ninety: bool) -> Result<String, JsValue> {
    serde_json::to_string(
        &copernicus_urls(serde_json::from_str(bounds).map_err(err)?, ninety).map_err(err)?,
    )
    .map_err(err)
}

/// Return an Overpass query for serialized bounds and optional winter features.
#[wasm_bindgen]
pub fn osm_query(bounds: &str, winter: bool) -> Result<String, JsValue> {
    overpass_query(serde_json::from_str(bounds).map_err(err)?, winter).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_is_aligned_and_contains_mesh_counts() {
        let mesh = Mesh {
            positions: vec![1., 2., 3.],
            indices: vec![0, 0, 0],
        };
        let packet = encode_packet(&serde_json::json!({"ok": true}), &[&mesh]).unwrap();
        assert_eq!(&packet[0..4], b"CWB1");
        assert_eq!(u32::from_le_bytes(packet[8..12].try_into().unwrap()), 1);
        assert_eq!(u32::from_le_bytes(packet[12..16].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(packet[16..20].try_into().unwrap()), 3);
        let metadata_len = u32::from_le_bytes(packet[4..8].try_into().unwrap()) as usize;
        assert_eq!((20 + metadata_len + 3) & !3, 32);
        assert_eq!(packet.len(), 56);
    }
}
