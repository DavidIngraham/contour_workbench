//! Shared serialized geometry models and their local invariants.

use crate::{boundary_bounds, Grid, Settings, Treatment};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Geographic-to-printer transformation chosen for a terrain model.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Layout {
    /// Geographic bounds as `[west, south, east, north]`.
    pub bounds: [f64; 4],
    /// Model width in millimeters.
    pub width: f64,
    /// Model depth in millimeters.
    pub depth: f64,
    /// Millimeters of model XY per meter on the ground.
    pub scale: f64,
    /// Whether the geographic extent was rotated 90 degrees to fit the bed.
    pub rotated: bool,
    /// Counterclockwise bed rotation in degrees; absent in legacy layouts.
    #[serde(default)]
    pub rotation_deg: Option<f64>,
    /// Rotated ground-coordinate minimum, in meters, before printer scaling.
    #[serde(default)]
    pub offset_m: [f64; 2],
    /// Minimum source elevation used as the relief datum, in meters.
    pub minimum: f64,
    /// Vertical relief multiplier.
    pub height_factor: f64,
    /// Base thickness in millimeters.
    pub base_height: f64,
}
impl Layout {
    /// Choose the orientation and scale that maximize print-bed usage.
    pub fn new(g: &Grid, s: &Settings) -> Self {
        let b = if s.boundary.is_empty() {
            g.bounds
        } else {
            boundary_bounds(&s.boundary)
        };
        let w = (b[2] - b[0]) * 111319.490793 * ((b[3] + b[1]) * 0.5).to_radians().cos();
        let h = (b[3] - b[1]) * 111319.490793;
        let points = if s.boundary.is_empty() {
            vec![[0., 0.], [w, 0.], [w, h], [0., h]]
        } else {
            s.boundary
                .iter()
                .map(|p| {
                    [
                        (p[0] - b[0]) / (b[2] - b[0]) * w,
                        (p[1] - b[1]) / (b[3] - b[1]) * h,
                    ]
                })
                .collect()
        };
        let fit = |degrees: f64| {
            let (sin, cos) = degrees.to_radians().sin_cos();
            let mut bounds = [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ];
            for p in &points {
                let x = p[0] * cos - p[1] * sin;
                let y = p[0] * sin + p[1] * cos;
                bounds[0] = bounds[0].min(x);
                bounds[1] = bounds[1].min(y);
                bounds[2] = bounds[2].max(x);
                bounds[3] = bounds[3].max(y);
            }
            let width = bounds[2] - bounds[0];
            let depth = bounds[3] - bounds[1];
            (
                (s.max_print_size_mm[0] / width).min(s.max_print_size_mm[1] / depth),
                width,
                depth,
                [bounds[0], bounds[1]],
            )
        };
        // Deterministic angular search, refined to 0.01 degrees around the best sample.
        let mut angle = s.bed_rotation_deg.unwrap_or(0.);
        if s.bed_rotation_deg.is_none() {
            let mut best = fit(angle).0;
            for step in 1..1800 {
                let candidate = f64::from(step) / 10.;
                let scale = fit(candidate).0;
                if scale > best * (1. + 1e-12) {
                    best = scale;
                    angle = candidate;
                }
            }
            let coarse = angle;
            for step in -10..=10 {
                let candidate = (coarse + f64::from(step) / 100.).rem_euclid(180.);
                let scale = fit(candidate).0;
                if scale > best * (1. + 1e-12) {
                    best = scale;
                    angle = candidate;
                }
            }
        }
        let (scale, width, depth, offset_m) = fit(angle);
        let rotated = (angle - 90.).abs() < 1e-9;
        Self {
            bounds: b,
            width: width * scale,
            depth: depth * scale,
            scale,
            rotated,
            rotation_deg: Some(angle),
            offset_m,
            minimum: g.elevations.iter().copied().fold(f64::INFINITY, f64::min),
            height_factor: s.height_factor,
            base_height: s.base_height_mm,
        }
    }
    /// Convert longitude/latitude to model XY millimeters.
    pub fn xy(&self, p: [f64; 2]) -> [f64; 2] {
        if let Some(angle) = self.rotation_deg {
            let x = (p[0] - self.bounds[0])
                * 111319.490793
                * ((self.bounds[1] + self.bounds[3]) * 0.5).to_radians().cos();
            let y = (p[1] - self.bounds[1]) * 111319.490793;
            let (sin, cos) = angle.to_radians().sin_cos();
            return [
                (x * cos - y * sin - self.offset_m[0]) * self.scale,
                (x * sin + y * cos - self.offset_m[1]) * self.scale,
            ];
        }
        let u = (p[0] - self.bounds[0]) / (self.bounds[2] - self.bounds[0]);
        let v = (p[1] - self.bounds[1]) / (self.bounds[3] - self.bounds[1]);
        if self.rotated {
            [(1. - v) * self.width, u * self.depth]
        } else {
            [u * self.width, v * self.depth]
        }
    }
    /// Convert model XY millimeters to longitude/latitude.
    pub fn lonlat(&self, p: [f64; 2]) -> [f64; 2] {
        if let Some(angle) = self.rotation_deg {
            let x = p[0] / self.scale + self.offset_m[0];
            let y = p[1] / self.scale + self.offset_m[1];
            let (sin, cos) = angle.to_radians().sin_cos();
            return [
                self.bounds[0]
                    + (x * cos + y * sin)
                        / (111319.490793
                            * ((self.bounds[1] + self.bounds[3]) * 0.5).to_radians().cos()),
                self.bounds[1] + (-x * sin + y * cos) / 111319.490793,
            ];
        }
        let (u, v) = if self.rotated {
            (p[1] / self.depth, 1. - p[0] / self.width)
        } else {
            (p[0] / self.width, p[1] / self.depth)
        };
        [
            self.bounds[0] + u * (self.bounds[2] - self.bounds[0]),
            self.bounds[1] + v * (self.bounds[3] - self.bounds[1]),
        ]
    }
    /// Sample terrain height at model XY, returning millimeters above the build plate.
    pub fn z(&self, g: &Grid, p: [f64; 2]) -> f64 {
        let q = self.lonlat(p);
        (g.sample(q[0], q[1]) - self.minimum) * self.scale * self.height_factor + self.base_height
    }
}
/// Indexed triangle mesh in printer-space millimeters.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Mesh {
    /// Flat XYZ vertex array.
    pub positions: Vec<f64>,
    /// Counter-clockwise triangle indices.
    pub indices: Vec<u32>,
}
impl Mesh {
    /// Verify indices and closed, consistently oriented two-manifold edges.
    pub fn validate(&self) -> Result<(), String> {
        let mut edges: HashMap<(u32, u32), (u32, i32)> = HashMap::new();
        for t in self.indices.chunks_exact(3) {
            for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
                if a == b
                    || a as usize >= self.positions.len() / 3
                    || b as usize >= self.positions.len() / 3
                {
                    return Err("Degenerate or invalid mesh face".into());
                }
                let e = edges.entry((a.min(b), a.max(b))).or_default();
                e.0 += 1;
                e.1 += if a < b { 1 } else { -1 };
            }
        }
        if edges.is_empty() || edges.values().any(|&(n, d)| n != 2 || d != 0) {
            return Err(format!(
                "Mesh is not a closed consistently oriented solid ({} vertices): {:?}",
                self.positions.len() / 3,
                edges
                    .iter()
                    .filter(|(_, &(n, d))| n != 2 || d != 0)
                    .take(5)
                    .map(|(&(a, b), &(count, direction))| {
                        (
                            (
                                &self.positions[a as usize * 3..a as usize * 3 + 3],
                                &self.positions[b as usize * 3..b as usize * 3 + 3],
                            ),
                            (count, direction),
                        )
                    })
                    .collect::<Vec<_>>()
            ));
        }
        Ok(())
    }
    /// Serialize this mesh as an ASCII STL in millimeters.
    pub fn stl(&self) -> String {
        let mut s = String::from("solid contour_workbench\n");
        for t in self.indices.chunks_exact(3) {
            s.push_str("facet normal 0 0 0\nouter loop\n");
            for &i in t {
                let i = i as usize * 3;
                s.push_str(&format!(
                    "vertex {:.12} {:.12} {:.12}\n",
                    self.positions[i],
                    self.positions[i + 1],
                    self.positions[i + 2]
                ));
            }
            s.push_str("endloop\nendfacet\n");
        }
        s.push_str("endsolid contour_workbench\n");
        s
    }
}
/// Lightweight design-preview mesh associated with one feature.
#[derive(Serialize, Deserialize)]
pub struct Overlay {
    /// Effective feature treatment.
    pub treatment: Treatment,
    /// Feature or feature-part identifier.
    pub id: String,
    /// Normalized feature class.
    pub class: String,
    /// Effective signed insert-top offset from terrain; zero for V-carves.
    #[serde(default)]
    pub surface_offset_mm: f64,
    /// Preview mesh in assembly coordinates.
    pub mesh: Mesh,
}
/// Separately printable insert piece and its assembly origin.
#[derive(Serialize, Deserialize)]
pub struct Piece {
    /// Stable generated piece identifier.
    pub id: String,
    /// Normalized feature class.
    pub class: String,
    /// Piece-local printable mesh.
    pub mesh: Mesh,
    /// Translation from piece-local coordinates to terrain assembly coordinates, in millimeters.
    pub origin: [f64; 3],
    /// Buried depth of the piece in millimeters.
    pub insert_depth_mm: f64,
    /// Effective signed insert-top offset from sampled terrain.
    #[serde(default = "default_insert_surface_offset_mm")]
    pub surface_offset_mm: f64,
    #[serde(default)]
    /// Whether the browser must intersect the prism with a shifted terrain surface.
    pub conformal: bool,
}
fn default_insert_surface_offset_mm() -> f64 {
    0.35
}

/// Geometry plan consumed by the browser solid-boolean stage.
#[derive(Serialize, Deserialize)]
pub struct Plan {
    /// Final planned terrain mesh; pockets are constructed directly when validation succeeds.
    pub terrain: Mesh,
    /// Separately printable insert pieces.
    pub inserts: Vec<Piece>,
    /// Remaining Boolean cutters, including V-carves and bounded pocket fallbacks.
    pub cutters: Vec<Mesh>,
    /// Exclusive cutter indices that end each boolean group.
    pub cutter_group_ends: Vec<usize>,
    /// Count of enclosed terrain pins removed as too narrow to print reliably.
    pub removed_terrain_islands: usize,
    /// Closed outlines of removed pins in assembly XYZ millimeters, sampled at the terrain surface.
    /// Diagnostic only: never included in manufactured meshes.
    #[serde(default)]
    pub removed_terrain_island_outlines: Vec<Vec<[f64; 3]>>,
}
