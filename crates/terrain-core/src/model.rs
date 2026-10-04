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
        let a = (s.max_print_size_mm[0] / w).min(s.max_print_size_mm[1] / h);
        let r = (s.max_print_size_mm[0] / h).min(s.max_print_size_mm[1] / w);
        let rotated = r > a;
        let scale = a.max(r);
        Self {
            bounds: b,
            width: if rotated { h * scale } else { w * scale },
            depth: if rotated { w * scale } else { h * scale },
            scale,
            rotated,
            minimum: g.elevations.iter().copied().fold(f64::INFINITY, f64::min),
            height_factor: s.height_factor,
            base_height: s.base_height_mm,
        }
    }
    /// Convert longitude/latitude to model XY millimeters.
    pub fn xy(&self, p: [f64; 2]) -> [f64; 2] {
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
    #[serde(default)]
    /// Whether the browser must intersect the prism with a shifted terrain surface.
    pub conformal: bool,
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
}
