//! Contour Workbench's platform-independent geometry and source-planning core.
mod carve;
use geo::{
    BooleanOps, Buffer, Contains, Coord, Intersects, LineString, MultiPolygon, Point, Polygon,
    TriangulateEarcut, Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use spade::FloatTriangulation;
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub max_print_size_mm: [f64; 2],
    pub height_factor: f64,
    pub base_height_mm: f64,
    pub path_width_mm: f64,
    pub path_clearance_mm: f64,
    pub insert_depth_mm: f64,
    pub carve_depth_mm: f64,
    pub insert_gap_mm: f64,
    pub insert_segment_size_mm: Option<f64>,
    pub terrain_max_error_mm: f64,
    pub boundary: Vec<[f64; 2]>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            max_print_size_mm: [248., 198.],
            height_factor: 1.,
            base_height_mm: 1.,
            path_width_mm: 0.8,
            path_clearance_mm: 0.1,
            insert_depth_mm: 2.,
            carve_depth_mm: 0.4,
            insert_gap_mm: 0.5,
            insert_segment_size_mm: None,
            terrain_max_error_mm: 0.,
            boundary: vec![],
        }
    }
}
pub fn boundary_bounds(points: &[[f64; 2]]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for p in points {
        b[0] = b[0].min(p[0]);
        b[1] = b[1].min(p[1]);
        b[2] = b[2].max(p[0]);
        b[3] = b[3].max(p[1]);
    }
    b
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.boundary.is_empty() {
            if self.boundary.len() < 3
                || self.boundary.len() > 500
                || self.boundary.iter().flatten().any(|v| !v.is_finite())
            {
                return Err("Boundary requires 3–500 finite vertices".into());
            }
            validate_bounds(boundary_bounds(&self.boundary))?;
            if !polygon(&self.boundary).is_valid() {
                return Err("Boundary must be a simple polygon without crossing edges".into());
            }
        }
        for v in [
            self.max_print_size_mm[0],
            self.max_print_size_mm[1],
            self.height_factor,
            self.base_height_mm,
            self.path_width_mm,
            self.path_clearance_mm,
            self.insert_depth_mm,
            self.carve_depth_mm,
            self.insert_gap_mm,
        ] {
            if !v.is_finite() || v <= 0. {
                return Err("Dimensions must be finite and positive".into());
            }
        }
        if !self.terrain_max_error_mm.is_finite() || self.terrain_max_error_mm < 0. {
            return Err("Height error must be nonnegative".into());
        }
        if self.insert_gap_mm <= self.path_clearance_mm {
            return Err("Insert gap must exceed path clearance".into());
        }
        if self
            .insert_segment_size_mm
            .is_some_and(|x| !x.is_finite() || x <= 0.)
        {
            return Err("Segment size must be positive".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grid {
    pub bounds: [f64; 4],
    pub width: usize,
    pub height: usize,
    pub elevations: Vec<f64>,
}
impl Grid {
    pub fn validate(&self) -> Result<(), String> {
        if self.width < 2
            || self.height < 2
            || self.width * self.height != self.elevations.len()
            || self.elevations.len() > 2_000_000
        {
            return Err("Elevation grid must contain 2–2,000,000 valid samples".into());
        }
        validate_bounds(self.bounds)?;
        if self.elevations.iter().any(|x| !x.is_finite()) {
            return Err("Elevation coverage contains missing samples".into());
        }
        Ok(())
    }
    pub fn sample(&self, lon: f64, lat: f64) -> f64 {
        let x = ((lon - self.bounds[0]) / (self.bounds[2] - self.bounds[0])
            * (self.width - 1) as f64)
            .clamp(0., (self.width - 1) as f64);
        let y = ((lat - self.bounds[1]) / (self.bounds[3] - self.bounds[1])
            * (self.height - 1) as f64)
            .clamp(0., (self.height - 1) as f64);
        let i = (x.floor() as usize).min(self.width - 2);
        let j = (y.floor() as usize).min(self.height - 2);
        let u = x - i as f64;
        let v = y - j as f64;
        let z = |a, b| self.elevations[b * self.width + a];
        z(i, j) * (1. - u) * (1. - v)
            + z(i + 1, j) * u * (1. - v)
            + z(i, j + 1) * (1. - u) * v
            + z(i + 1, j + 1) * u * v
    }
}
pub fn validate_bounds(b: [f64; 4]) -> Result<(), String> {
    if b.iter().any(|x| !x.is_finite())
        || b[0] >= b[2]
        || b[1] >= b[3]
        || b[0] < -180.
        || b[2] > 180.
        || b[1] < -85.
        || b[3] > 85.
        || b[2] - b[0] > 2.
        || b[3] - b[1] > 2.
    {
        return Err(
            "Use an area under 2° wide/high, between 85° S and 85° N; split dateline crossings"
                .into(),
        );
    }
    Ok(())
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Treatment {
    #[default]
    Insert,
    Hide,
    VCarve,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub class: String,
    pub lines: Vec<Vec<[f64; 2]>>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub treatment: Treatment,
    #[serde(default)]
    pub tags: Value,
}
impl Feature {
    pub fn treatment(&self) -> Treatment {
        if self.enabled {
            self.treatment
        } else {
            Treatment::Hide
        }
    }
}
fn yes() -> bool {
    true
}
pub fn classify(p: &Value) -> Option<&'static str> {
    let p = p.get("tags").filter(|x| x.is_object()).unwrap_or(p);
    if p.get("Trail_Name")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty())
    {
        let d = p.get("Difficulty").and_then(Value::as_str).unwrap_or("");
        return if ["Closed", "Future", "Concept"]
            .iter()
            .any(|x| d.contains(x))
        {
            None
        } else {
            Some("trail")
        };
    }
    if ["closed", "abandoned"].iter().any(|k| {
        p.get(k)
            .is_some_and(|v| v == true || ["yes", "true", "1"].contains(&v.as_str().unwrap_or("")))
    }) {
        return None;
    }
    match p.get("highway").and_then(Value::as_str).unwrap_or("") {
        "path" | "footway" | "bridleway" | "cycleway" | "track" => return Some("trail"),
        "motorway" | "trunk" | "primary" | "secondary" | "tertiary" | "unclassified"
        | "residential" | "service" | "living_street" => return Some("road"),
        _ => {}
    }
    if ["river", "stream", "drain", "ditch"]
        .contains(&p.get("waterway").and_then(Value::as_str).unwrap_or(""))
    {
        Some("stream")
    } else {
        None
    }
}
fn parse_line(value: &Value) -> Vec<[f64; 2]> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| Some([v.get(0)?.as_f64()?, v.get(1)?.as_f64()?]))
        .filter(|p| p[0].is_finite() && p[1].is_finite())
        .collect()
}
pub fn normalize(input: &Value) -> Vec<Feature> {
    let mut out = vec![];
    if let Some(elements) = input.get("elements").and_then(Value::as_array) {
        for e in elements {
            if e["type"] != "way" {
                continue;
            }
            let Some(class) = classify(&e["tags"]) else {
                continue;
            };
            let line: Vec<[f64; 2]> = e["geometry"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| Some([v["lon"].as_f64()?, v["lat"].as_f64()?]))
                .collect();
            if line.len() < 2 {
                continue;
            }
            let id = format!("osm:way:{}", e["id"]);
            let name = e["tags"]["name"].as_str().unwrap_or(class).to_string();
            out.push(Feature {
                id,
                name,
                class: class.into(),
                lines: vec![line],
                enabled: true,
                treatment: Treatment::Insert,
                tags: e["tags"].clone(),
            });
        }
    } else {
        for (i, f) in input["features"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            let Some(class) = classify(&f["properties"]) else {
                continue;
            };
            let g = &f["geometry"];
            let lines = match g["type"].as_str() {
                Some("LineString") => vec![parse_line(&g["coordinates"])],
                Some("MultiLineString") => g["coordinates"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(parse_line)
                    .collect(),
                _ => continue,
            };
            if lines.iter().all(|l| l.len() < 2) {
                continue;
            }
            let name = f["properties"]["Trail_Name"]
                .as_str()
                .or(f["properties"]["name"].as_str())
                .or(f["properties"]["tags"]["name"].as_str())
                .unwrap_or(class)
                .to_string();
            out.push(Feature {
                id: format!("upload:{i}"),
                name,
                class: class.into(),
                lines,
                enabled: true,
                treatment: Treatment::Insert,
                tags: f["properties"].clone(),
            });
        }
    }
    out
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Layout {
    pub bounds: [f64; 4],
    pub width: f64,
    pub depth: f64,
    pub scale: f64,
    pub rotated: bool,
    pub minimum: f64,
    pub height_factor: f64,
    pub base_height: f64,
}
impl Layout {
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
    pub fn xy(&self, p: [f64; 2]) -> [f64; 2] {
        let u = (p[0] - self.bounds[0]) / (self.bounds[2] - self.bounds[0]);
        let v = (p[1] - self.bounds[1]) / (self.bounds[3] - self.bounds[1]);
        if self.rotated {
            [(1. - v) * self.width, u * self.depth]
        } else {
            [u * self.width, v * self.depth]
        }
    }
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
    pub fn z(&self, g: &Grid, p: [f64; 2]) -> f64 {
        let q = self.lonlat(p);
        (g.sample(q[0], q[1]) - self.minimum) * self.scale * self.height_factor + self.base_height
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Mesh {
    pub positions: Vec<f64>,
    pub indices: Vec<u32>,
}
impl Mesh {
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
                "Mesh is not a closed consistently oriented solid: {:?}",
                edges
                    .iter()
                    .filter(|(_, &(n, d))| n != 2 || d != 0)
                    .take(5)
                    .collect::<Vec<_>>()
            ));
        }
        Ok(())
    }
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
fn polygon(coords: &[[f64; 2]]) -> Polygon<f64> {
    let mut v: Vec<Coord<f64>> = coords.iter().map(|p| Coord { x: p[0], y: p[1] }).collect();
    if v.first() != v.last() {
        if let Some(p) = v.first().copied() {
            v.push(p)
        }
    }
    Polygon::new(LineString(v), vec![])
}
fn rectangle(w: f64, h: f64) -> Polygon<f64> {
    polygon(&[[0., 0.], [w, 0.], [w, h], [0., h]])
}
fn solid(
    points: Vec<[f64; 2]>,
    faces: Vec<[u32; 3]>,
    top: impl Fn([f64; 2]) -> f64,
    base: f64,
) -> Mesh {
    solid_between(points, faces, top, |_| base)
}
fn solid_between(
    points: Vec<[f64; 2]>,
    faces: Vec<[u32; 3]>,
    top: impl Fn([f64; 2]) -> f64,
    bottom: impl Fn([f64; 2]) -> f64,
) -> Mesh {
    let n = points.len() as u32;
    let mut mesh = Mesh::default();
    for &p in &points {
        mesh.positions.extend([p[0], p[1], top(p)]);
    }
    for p in &points {
        mesh.positions.extend([p[0], p[1], bottom(*p)]);
    }
    let mut edges: HashMap<(u32, u32), (u32, u32, usize)> = HashMap::new();
    for t in faces {
        mesh.indices.extend(t);
        mesh.indices.extend([t[2] + n, t[1] + n, t[0] + n]);
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            let e = edges.entry((a.min(b), a.max(b))).or_insert((a, b, 0));
            e.2 += 1;
        }
    }
    for (_, (a, b, count)) in edges {
        if count == 1 {
            mesh.indices.extend([a, b + n, b, a, a + n, b + n]);
        }
    }
    mesh
}
fn polygon_surface(poly: &Polygon<f64>, top: impl Fn([f64; 2]) -> f64, base: f64) -> Mesh {
    polygon_surface_detail(poly, top, base, true)
}
fn polygon_surface_detail(
    poly: &Polygon<f64>,
    top: impl Fn([f64; 2]) -> f64,
    base: f64,
    densify: bool,
) -> Mesh {
    let dense = |r: &LineString<f64>| {
        let mut v = vec![];
        for pair in r.0.windows(2) {
            let a = pair[0];
            let b = pair[1];
            let n = (((b.x - a.x).hypot(b.y - a.y) / 0.6).ceil() as usize).max(1);
            for i in 0..n {
                let f = i as f64 / n as f64;
                v.push(Coord {
                    x: a.x + (b.x - a.x) * f,
                    y: a.y + (b.y - a.y) * f,
                });
            }
        }
        if let Some(p) = v.first().copied() {
            v.push(p)
        }
        LineString(v)
    };
    let p = if densify {
        Polygon::new(
            dense(poly.exterior()),
            poly.interiors().iter().map(dense).collect(),
        )
    } else {
        poly.clone()
    };
    let t = p.earcut_triangles_raw();
    let pts: Vec<[f64; 2]> = t.vertices;
    let faces = t
        .triangle_indices
        .chunks_exact(3)
        .map(|x| {
            let mut t = [x[0] as u32, x[1] as u32, x[2] as u32];
            let (a, b, c) = (pts[x[0]], pts[x[1]], pts[x[2]]);
            if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0. {
                t.swap(1, 2)
            }
            t
        })
        .collect();
    solid(pts, faces, top, base)
}
#[derive(Serialize, Deserialize)]
pub struct Terrain {
    pub mesh: Mesh,
    pub layout: Layout,
    pub source_samples: usize,
    pub retained_samples: usize,
}
pub fn terrain(g: &Grid, s: &Settings) -> Result<Terrain, String> {
    g.validate()?;
    s.validate()?;
    if s.boundary.iter().any(|p| {
        p[0] < g.bounds[0] || p[0] > g.bounds[2] || p[1] < g.bounds[1] || p[1] > g.bounds[3]
    }) {
        return Err("Elevation must cover the entire polygon".into());
    }
    let mut l = Layout::new(g, s);
    let bound = if s.boundary.len() >= 3 {
        polygon(&s.boundary.iter().map(|p| l.xy(*p)).collect::<Vec<_>>())
    } else {
        rectangle(l.width, l.depth)
    };
    let mut pts = vec![];
    for j in 0..g.height {
        for i in 0..g.width {
            pts.push(l.xy([
                g.bounds[0] + i as f64 / (g.width - 1) as f64 * (g.bounds[2] - g.bounds[0]),
                g.bounds[1] + j as f64 / (g.height - 1) as f64 * (g.bounds[3] - g.bounds[1]),
            ]));
        }
    }
    if !s.boundary.is_empty() {
        l.minimum = pts
            .iter()
            .zip(&g.elevations)
            .filter(|(p, _)| bound.intersects(&Point::new(p[0], p[1])))
            .map(|(_, z)| *z)
            .fold(f64::INFINITY, f64::min);
        if !l.minimum.is_finite() {
            return Err("Boundary contains no source samples".into());
        }
    }
    let mut faces = vec![];
    for j in 0..g.height - 1 {
        for i in 0..g.width - 1 {
            let a = (j * g.width + i) as u32;
            faces.extend([
                [a, a + 1, a + g.width as u32 + 1],
                [a, a + g.width as u32 + 1, a + g.width as u32],
            ]);
        }
    }
    if s.terrain_max_error_mm > 0. {
        let (p, f) = adaptive(&pts, g, s.terrain_max_error_mm, &l)?;
        pts = p;
        faces = f;
    }
    if !s.boundary.is_empty() {
        let mut vertices = vec![];
        let mut map = HashMap::new();
        let mut clipped = vec![];
        for t in &faces {
            let triangle = polygon(&[pts[t[0] as usize], pts[t[1] as usize], pts[t[2] as usize]]);
            let parts = if bound.contains(&triangle) {
                MultiPolygon(vec![triangle])
            } else {
                bound.intersection(&triangle)
            };
            for p in parts {
                let raw = p.earcut_triangles_raw();
                for face in raw.triangle_indices.chunks_exact(3) {
                    let mut idx = [0; 3];
                    for k in 0..3 {
                        let x = raw.vertices[face[k]][0];
                        let y = raw.vertices[face[k]][1];
                        // Search neighboring cells too: a rounding bin boundary must not
                        // split the same intersection into two coincident mesh edges.
                        let key = ((x * 1e4).round() as i64, (y * 1e4).round() as i64);
                        let mut existing = None;
                        for dx in -1..=1 {
                            for dy in -1..=1 {
                                if let Some(&id) = map.get(&(key.0 + dx, key.1 + dy)) {
                                    let q: [f64; 2] = vertices[id as usize];
                                    if (q[0] - x).abs() < 1e-4 && (q[1] - y).abs() < 1e-4 {
                                        existing = Some(id);
                                    }
                                }
                            }
                        }
                        idx[k] = existing.unwrap_or_else(|| {
                            let id = vertices.len() as u32;
                            vertices.push([x, y]);
                            map.insert(key, id);
                            id
                        });
                    }
                    let (a, b, c) = (
                        vertices[idx[0] as usize],
                        vertices[idx[1] as usize],
                        vertices[idx[2] as usize],
                    );
                    let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
                    if area.abs() < 1e-10 {
                        continue;
                    }
                    if area < 0. {
                        idx.swap(1, 2)
                    }
                    clipped.push(idx);
                }
            }
        }
        pts = vertices;
        faces = clipped;
    }
    if !s.boundary.is_empty() {
        l.minimum = pts
            .iter()
            .map(|p| {
                let q = l.lonlat(*p);
                g.sample(q[0], q[1])
            })
            .fold(f64::INFINITY, f64::min);
    }
    let retained = pts.len();
    let mesh = solid(pts, faces, |p| l.z(g, p), 0.);
    mesh.validate()?;
    Ok(Terrain {
        mesh,
        layout: l,
        source_samples: g.elevations.len(),
        retained_samples: retained,
    })
}
#[derive(Clone, Copy)]
struct Vertex {
    p: spade::Point2<f64>,
    z: f64,
}
impl spade::HasPosition for Vertex {
    type Scalar = f64;
    fn position(&self) -> spade::Point2<f64> {
        self.p
    }
}
fn adaptive(
    pts: &[[f64; 2]],
    g: &Grid,
    tol: f64,
    l: &Layout,
) -> Result<(Vec<[f64; 2]>, Vec<[u32; 3]>), String> {
    use spade::Triangulation;
    let mut selected = vec![false; pts.len()];
    let min = g
        .elevations
        .iter()
        .enumerate()
        .min_by(|a, b| a.1.total_cmp(b.1))
        .unwrap()
        .0;
    let max = g
        .elevations
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(b.1))
        .unwrap()
        .0;
    selected[min] = true;
    selected[max] = true;
    for (i, v) in selected.iter_mut().enumerate() {
        if i < g.width || i >= pts.len() - g.width || i % g.width == 0 || i % g.width == g.width - 1
        {
            *v = true
        }
    }
    let mut dt = spade::DelaunayTriangulation::<Vertex>::new();
    for (i, p) in pts.iter().enumerate() {
        if selected[i] {
            dt.insert(Vertex {
                p: spade::Point2::new(p[0], p[1]),
                z: l.z(g, *p),
            })
            .map_err(|e| format!("{e:?}"))?;
        }
    }
    loop {
        let mut worst: HashMap<usize, (usize, f64)> = HashMap::new();
        for (i, p) in pts.iter().enumerate() {
            if selected[i] {
                continue;
            }
            let point = spade::Point2::new(p[0], p[1]);
            let predicted = dt
                .barycentric()
                .interpolate(|v| v.data().z, point)
                .ok_or("Could not sample adaptive surface")?;
            let error = (predicted - l.z(g, *p)).abs();
            if error > tol {
                let face = match dt.locate(point) {
                    spade::PositionInTriangulation::OnFace(f) => f.index(),
                    _ => usize::MAX - i,
                };
                let item = worst.entry(face).or_insert((i, error));
                if error > item.1 {
                    *item = (i, error)
                }
            }
        }
        if worst.is_empty() {
            break;
        }
        for (i, _) in worst.values() {
            selected[*i] = true;
            let p = pts[*i];
            dt.insert(Vertex {
                p: spade::Point2::new(p[0], p[1]),
                z: l.z(g, p),
            })
            .map_err(|e| format!("{e:?}"))?;
        }
    }
    let points = dt
        .vertices()
        .map(|v| [v.position().x, v.position().y])
        .collect();
    let faces = dt
        .inner_faces()
        .map(|f| {
            let v = f.vertices();
            [
                v[0].fix().index() as u32,
                v[1].fix().index() as u32,
                v[2].fix().index() as u32,
            ]
        })
        .collect();
    Ok((points, faces))
}
#[derive(Serialize, Deserialize)]
pub struct Overlay {
    pub treatment: Treatment,
    pub id: String,
    pub class: String,
    pub mesh: Mesh,
}
fn feature_polygon(f: &Feature, l: &Layout, width: f64) -> MultiPolygon<f64> {
    let mut out = MultiPolygon(vec![]);
    for line in &f.lines {
        let ls = LineString(
            line.iter()
                .map(|p| {
                    let p = l.xy(*p);
                    Coord { x: p[0], y: p[1] }
                })
                .collect(),
        );
        out = out.union(&ls.buffer(width / 2.));
    }
    out
}
fn feature_boundary(s: &Settings, l: &Layout) -> MultiPolygon<f64> {
    let b = if s.boundary.len() >= 3 {
        polygon(&s.boundary.iter().map(|p| l.xy(*p)).collect::<Vec<_>>())
    } else {
        rectangle(l.width, l.depth)
    };
    b.buffer(-2. * s.path_width_mm)
}
// Preview ribbons follow the surface on both sides instead of extending to the model base.
fn preview_ribbon(poly: &Polygon<f64>, surface: impl Fn([f64; 2]) -> f64) -> Mesh {
    let mut mesh = polygon_surface(poly, |p| surface(p) + 0.35, 0.);
    let half = mesh.positions.len() / 2;
    for i in (half..mesh.positions.len()).step_by(3) {
        mesh.positions[i + 2] = mesh.positions[i - half + 2] - 0.35;
    }
    mesh
}
pub fn overlays(
    g: &Grid,
    s: &Settings,
    features: &[Feature],
    l: &Layout,
) -> Result<Vec<Overlay>, String> {
    s.validate()?;
    let clip = feature_boundary(s, l);
    let mut occupied = MultiPolygon(vec![]);
    let mut occupied_inserts = MultiPolygon(vec![]);
    let mut out = vec![];
    for class in ["trail", "road", "stream"] {
        let mut inserts = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() == Treatment::Insert)
        {
            inserts = inserts.union(&feature_polygon(f, l, s.path_width_mm));
        }
        let allowed =
            clip.difference(&occupied_inserts.union(&inserts.buffer(s.path_clearance_mm / 2.)));
        let mut carved = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() != Treatment::Hide)
        {
            let footprint = feature_polygon(f, l, s.path_width_mm);
            let footprint = if f.treatment() == Treatment::VCarve {
                footprint.buffer(-0.001).buffer(0.001)
            } else {
                footprint
            };
            let polygons = footprint.intersection(if f.treatment() == Treatment::VCarve {
                &allowed
            } else {
                &clip
            });
            for (i, p) in polygons.0.iter().enumerate() {
                let mesh = if f.treatment() == Treatment::VCarve {
                    carve::surface(
                        carve::mesh(g, s, f, l, p, 10000., false)
                            .map_err(|e| format!("{} groove: {e}", f.id))?,
                    )
                } else {
                    preview_ribbon(p, |p| l.z(g, p))
                };
                out.push(Overlay {
                    treatment: f.treatment(),
                    id: format!("{}#{i}", f.id),
                    class: f.class.clone(),
                    mesh,
                });
            }
            if f.treatment() == Treatment::VCarve {
                carved = carved.union(&polygons);
            }
        }
        occupied = occupied.union(&inserts).union(&carved);
        occupied_inserts = occupied_inserts.union(&inserts);
    }
    Ok(out)
}
#[derive(Serialize, Deserialize)]
pub struct Piece {
    pub id: String,
    pub class: String,
    pub mesh: Mesh,
    pub origin: [f64; 3],
}
#[derive(Serialize, Deserialize)]
pub struct Plan {
    pub inserts: Vec<Piece>,
    pub cutters: Vec<Mesh>,
}
pub fn plan(g: &Grid, s: &Settings, features: &[Feature], l: &Layout) -> Result<Plan, String> {
    s.validate()?;
    let clip = feature_boundary(s, l);
    let mut occupied = MultiPolygon(vec![]);
    let mut occupied_inserts = MultiPolygon(vec![]);
    let mut out = Plan {
        inserts: vec![],
        cutters: vec![],
    };
    let seg = s
        .insert_segment_size_mm
        .map(|v| [v, v])
        .unwrap_or(s.max_print_size_mm);
    let roof = g
        .elevations
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let roof = (roof - l.minimum) * l.scale * l.height_factor + l.base_height + 5.;
    for class in ["trail", "road", "stream"] {
        let mut union = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.treatment() == Treatment::Insert && f.class == class)
        {
            union = union.union(&feature_polygon(f, l, s.path_width_mm));
        }
        let layer = union.intersection(&clip).difference(&occupied);
        // Overlap cutters slightly inside the pocket clearance to avoid coincident Boolean walls.
        // Keep the actual insert footprint protected, even with zero clearance.
        let protected = occupied_inserts
            .union(&layer)
            .buffer((s.path_clearance_mm / 2. - 0.002).max(0.));
        let allowed = clip.difference(&protected);
        let mut carved = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() == Treatment::VCarve)
        {
            let domain = feature_polygon(f, l, s.path_width_mm + 0.002)
                .buffer(-0.001)
                .buffer(0.001)
                .intersection(&allowed);
            for p in &domain.0 {
                out.cutters.push(carve::mesh(g, s, f, l, p, roof, true)?);
            }
            carved = carved.union(&domain);
        }
        occupied = occupied.union(&layer).union(&carved);
        occupied_inserts = occupied_inserts.union(&layer);
        for row in 0..(l.depth / seg[1]).ceil() as usize {
            for col in 0..(l.width / seg[0]).ceil() as usize {
                let x = col as f64 * seg[0];
                let y = row as f64 * seg[1];
                let cell = polygon(&[
                    [x, y],
                    [x + seg[0], y],
                    [x + seg[0], y + seg[1]],
                    [x, y + seg[1]],
                ]);
                let pockets = layer.intersection(&MultiPolygon(vec![cell.clone()]));
                // Remove microscopic point contacts before triangulating printable inserts.
                let parts = layer
                    .intersection(&cell.buffer(-s.insert_gap_mm / 2.))
                    .buffer(-0.001)
                    .buffer(0.001);
                let mut base = f64::INFINITY;
                for p in &pockets.0 {
                    for c in &p.exterior().0 {
                        base = base.min(l.z(g, [c.x, c.y]) - s.insert_depth_mm);
                    }
                }
                if !base.is_finite() {
                    continue;
                }
                base = base.max(0.75);
                for (i, p) in parts.0.iter().enumerate() {
                    let mut mesh = polygon_surface(p, |p| l.z(g, p) + 0.35, base);
                    mesh.validate()
                        .map_err(|e| format!("{class} insert {row},{col},{i}: {e}"))?;
                    let mut origin = [f64::INFINITY; 3];
                    for p in mesh.positions.chunks_exact(3) {
                        for k in 0..3 {
                            origin[k] = origin[k].min(p[k]);
                        }
                    }
                    for p in mesh.positions.chunks_exact_mut(3) {
                        for k in 0..3 {
                            p[k] -= origin[k];
                        }
                    }
                    out.inserts.push(Piece {
                        id: format!("{class}-r{}-c{}-{}", row + 1, col + 1, i + 1),
                        class: class.into(),
                        mesh,
                        origin,
                    });
                }
                for p in pockets.buffer(s.path_clearance_mm / 2.).0 {
                    let mesh = polygon_surface_detail(&p, |_| roof, (base - 0.15).max(0.4), false);
                    mesh.validate()
                        .map_err(|e| format!("{class} pocket {row},{col}: {e}"))?;
                    out.cutters.push(mesh);
                }
            }
        }
    }
    Ok(out)
}
pub fn copernicus_urls(b: [f64; 4], ninety: bool) -> Result<Vec<String>, String> {
    validate_bounds(b)?;
    let bucket = if ninety {
        "copernicus-dem-90m"
    } else {
        "copernicus-dem-30m"
    };
    let token = if ninety { "30" } else { "10" };
    let mut urls = vec![];
    for lat in b[1].floor() as i32..b[3].ceil() as i32 {
        for lon in b[0].floor() as i32..b[2].ceil() as i32 {
            let name = format!(
                "Copernicus_DSM_COG_{token}_{}{:02}_00_{}{:03}_00_DEM",
                if lat < 0 { "S" } else { "N" },
                lat.abs(),
                if lon < 0 { "W" } else { "E" },
                lon.abs()
            );
            urls.push(format!(
                "https://{bucket}.s3.eu-central-1.amazonaws.com/{name}/{name}.tif"
            ));
        }
    }
    Ok(urls)
}
pub fn overpass_query(b: [f64; 4]) -> Result<String, String> {
    validate_bounds(b)?;
    Ok(format!("[out:json][timeout:45];(way[highway~\"^(path|footway|bridleway|cycleway|track|motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)$\"]({},{},{},{});way[waterway~\"^(river|stream|drain|ditch)$\"]({},{},{},{}););out body geom;",b[1],b[0],b[3],b[2],b[1],b[0],b[3],b[2]))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn grid() -> Grid {
        Grid {
            bounds: [-122., 45., -121.99, 45.01],
            width: 5,
            height: 5,
            elevations: (0..25).map(|i| 100. + (i % 5) as f64 * 10.).collect(),
        }
    }
    #[test]
    fn preview_ribbon_follows_surface_with_original_protrusion() {
        let mesh = preview_ribbon(&rectangle(4., 3.), |p| 2. + p[0] * 0.7 + p[1] * 0.2);
        let half = mesh.positions.len() / 2;
        for (i, p) in mesh.positions.chunks_exact(3).enumerate() {
            let surface = 2. + p[0] * 0.7 + p[1] * 0.2;
            let expected = surface + if i * 3 < half { 0.35 } else { 0. };
            assert!((p[2] - expected).abs() < 1e-9);
        }
        mesh.validate().unwrap();
    }
    #[test]
    fn classification_parity() {
        assert_eq!(classify(&json!({"highway":"path"})), Some("trail"));
        assert_eq!(classify(&json!({"highway":"path","closed":"yes"})), None);
        assert_eq!(
            classify(&json!({"Trail_Name":"A","closed":true})),
            Some("trail")
        );
        assert_eq!(
            classify(&json!({"Trail_Name":"A","Difficulty":"Future"})),
            None
        );
        assert_eq!(
            classify(&json!({"highway":"service","waterway":"stream"})),
            Some("road")
        );
    }
    #[test]
    fn full_resolution_solid() {
        let t = terrain(&grid(), &Settings::default()).unwrap();
        assert_eq!(t.retained_samples, 25);
        t.mesh.validate().unwrap();
        let min = t
            .mesh
            .positions
            .chunks_exact(3)
            .filter(|p| p[2] > 0.)
            .map(|p| p[2])
            .fold(f64::INFINITY, f64::min);
        assert!((min - 1.).abs() < 1e-8);
    }
    #[test]
    fn adaptive_planar() {
        let g = grid();
        let s = Settings {
            terrain_max_error_mm: 0.05,
            ..Default::default()
        };
        let t = terrain(&g, &s).unwrap();
        assert!(t.retained_samples < 25);
        t.mesh.validate().unwrap();
    }
    #[test]
    fn tile_hemispheres() {
        let u = copernicus_urls([-0.1, -0.1, 0.1, 0.1], false).unwrap();
        assert_eq!(u.len(), 4);
        assert!(u.iter().any(|s| s.contains("S01_00_W001")));
    }
    #[test]
    fn no_disabled_cutters() {
        let g = grid();
        let t = terrain(&g, &Settings::default()).unwrap();
        let p = plan(&g, &Settings::default(), &[], &t.layout).unwrap();
        assert!(p.cutters.is_empty());
    }
}
