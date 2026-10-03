#![warn(missing_docs)]
//! Browser boundary for Contour Workbench's Rust geometry core.
//!
//! A session owns the elevation grid so repeated overlay and model builds do not
//! resend or reparse the largest project object. Geometry is returned in the
//! versioned `CWB1` packet format: JSON metadata followed by aligned
//! `f32` positions and `u32` triangle indices.

use contour_core::*;
use serde::Serialize;
use std::{collections::VecDeque, ops::Range};
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
    cutter_batches: usize,
    insert_batches: usize,
    removed_terrain_islands: usize,
}

#[derive(Serialize)]
struct MeshBatchMetadata {
    batch_index: usize,
    batch_total: usize,
    start_index: usize,
    done: bool,
}

struct PendingPlan {
    plan: Plan,
    cutter_batches: VecDeque<Range<usize>>,
    insert_batches: VecDeque<Range<usize>>,
    completed_cutter_batches: usize,
    total_cutter_batches: usize,
    completed_insert_batches: usize,
    total_insert_batches: usize,
}

fn batch_ranges(
    length: usize,
    group_ends: &[usize],
    triangle_count: impl Fn(usize) -> usize,
    maximum_triangles: usize,
    maximum_meshes: usize,
) -> VecDeque<Range<usize>> {
    let maximum_triangles = maximum_triangles.max(1);
    let maximum_meshes = maximum_meshes.max(1);
    let mut ranges = VecDeque::new();
    let mut group_start = 0;
    let mut ends = group_ends.to_vec();
    if ends.last().copied().unwrap_or(0) < length {
        ends.push(length);
    }
    for group_end in ends {
        let group_end = group_end.min(length);
        if group_end <= group_start {
            continue;
        }
        let mut batch_start = group_start;
        let mut triangles = 0;
        for index in group_start..group_end {
            let next_triangles = triangle_count(index);
            if index > batch_start
                && (triangles + next_triangles > maximum_triangles
                    || index - batch_start >= maximum_meshes)
            {
                ranges.push_back(batch_start..index);
                batch_start = index;
                triangles = 0;
            }
            triangles += next_triangles;
        }
        if batch_start < group_end {
            ranges.push_back(batch_start..group_end);
        }
        group_start = group_end;
    }
    ranges
}

fn take_mesh(mesh: &mut Mesh) -> Mesh {
    Mesh {
        positions: std::mem::take(&mut mesh.positions),
        indices: std::mem::take(&mut mesh.indices),
    }
}

/// Stateful browser geometry session that owns one validated elevation grid.
#[wasm_bindgen]
pub struct TerrainSession {
    grid: Grid,
    pending_plan: Option<PendingPlan>,
}

#[wasm_bindgen]
impl TerrainSession {
    /// Parse and validate an elevation grid, then create a reusable session.
    #[wasm_bindgen(constructor)]
    pub fn new(grid: &str) -> Result<TerrainSession, JsValue> {
        let grid: Grid = serde_json::from_str(grid).map_err(err)?;
        grid.validate().map_err(err)?;
        Ok(Self {
            grid,
            pending_plan: None,
        })
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

    /// Prepare a geometry plan while keeping its meshes inside WASM for bounded transfer.
    pub fn prepare_plan(
        &mut self,
        settings: &str,
        features: &str,
        layout: &str,
        maximum_triangles: usize,
        maximum_meshes: usize,
    ) -> Result<String, JsValue> {
        self.pending_plan = None;
        let settings: Settings = serde_json::from_str(settings).map_err(err)?;
        let features: Vec<Feature> = serde_json::from_str(features).map_err(err)?;
        let layout: Layout = serde_json::from_str(layout).map_err(err)?;
        let plan = plan(&self.grid, &settings, &features, &layout).map_err(err)?;
        let cutter_batches = batch_ranges(
            plan.cutters.len(),
            &plan.cutter_group_ends,
            |index| plan.cutters[index].indices.len() / 3,
            maximum_triangles,
            maximum_meshes,
        );
        let insert_batches = batch_ranges(
            plan.inserts.len(),
            &[plan.inserts.len()],
            |index| plan.inserts[index].mesh.indices.len() / 3,
            maximum_triangles,
            maximum_meshes,
        );
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
            cutter_batches: cutter_batches.len(),
            insert_batches: insert_batches.len(),
            removed_terrain_islands: plan.removed_terrain_islands,
        };
        let encoded = serde_json::to_string(&metadata).map_err(err)?;
        let total_cutter_batches = cutter_batches.len();
        let total_insert_batches = insert_batches.len();
        self.pending_plan = Some(PendingPlan {
            plan,
            cutter_batches,
            insert_batches,
            completed_cutter_batches: 0,
            total_cutter_batches,
            completed_insert_batches: 0,
            total_insert_batches,
        });
        Ok(encoded)
    }

    /// Transfer and release the next cutter batch from a prepared plan.
    pub fn take_plan_cutter_batch(&mut self) -> Result<Vec<u8>, JsValue> {
        let pending = self
            .pending_plan
            .as_mut()
            .ok_or_else(|| err("No prepared geometry plan"))?;
        let Some(range) = pending.cutter_batches.pop_front() else {
            let metadata = MeshBatchMetadata {
                batch_index: pending.completed_cutter_batches,
                batch_total: pending.total_cutter_batches,
                start_index: pending.plan.cutters.len(),
                done: true,
            };
            return encode_packet(&metadata, &[]);
        };
        let start_index = range.start;
        let mut batch = Vec::with_capacity(range.len());
        for index in range {
            batch.push(take_mesh(&mut pending.plan.cutters[index]));
        }
        pending.completed_cutter_batches += 1;
        let metadata = MeshBatchMetadata {
            batch_index: pending.completed_cutter_batches,
            batch_total: pending.total_cutter_batches,
            start_index,
            done: pending.cutter_batches.is_empty(),
        };
        let meshes: Vec<_> = batch.iter().collect();
        encode_packet(&metadata, &meshes)
    }

    /// Transfer and release the next insert batch after all cutters are consumed.
    pub fn take_plan_insert_batch(&mut self) -> Result<Vec<u8>, JsValue> {
        let pending = self
            .pending_plan
            .as_mut()
            .ok_or_else(|| err("No prepared geometry plan"))?;
        if !pending.cutter_batches.is_empty() {
            return Err(err("Consume every cutter batch before taking inserts"));
        }
        let Some(range) = pending.insert_batches.pop_front() else {
            let metadata = MeshBatchMetadata {
                batch_index: pending.completed_insert_batches,
                batch_total: pending.total_insert_batches,
                start_index: pending.plan.inserts.len(),
                done: true,
            };
            return encode_packet(&metadata, &[]);
        };
        let start_index = range.start;
        let mut batch = Vec::with_capacity(range.len());
        for index in range {
            batch.push(take_mesh(&mut pending.plan.inserts[index].mesh));
        }
        pending.completed_insert_batches += 1;
        let metadata = MeshBatchMetadata {
            batch_index: pending.completed_insert_batches,
            batch_total: pending.total_insert_batches,
            start_index,
            done: pending.insert_batches.is_empty(),
        };
        let meshes: Vec<_> = batch.iter().collect();
        encode_packet(&metadata, &meshes)
    }

    /// Release any prepared geometry plan after cancellation or failure.
    pub fn clear_plan(&mut self) {
        self.pending_plan = None;
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
    fn cutter_batches_respect_group_and_memory_limits() {
        let mesh = |triangles: usize| Mesh {
            positions: vec![0.; triangles * 9],
            indices: (0..triangles * 3).map(|index| index as u32).collect(),
        };
        let cutters = [mesh(2), mesh(2), mesh(1), mesh(4)];
        let ranges = batch_ranges(
            cutters.len(),
            &[3, 4],
            |index| cutters[index].indices.len() / 3,
            3,
            2,
        );
        assert_eq!(
            ranges.into_iter().collect::<Vec<_>>(),
            vec![0..1, 1..3, 3..4]
        );
    }

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
