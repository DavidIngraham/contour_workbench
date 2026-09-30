//! Contour Workbench's platform-independent geometry and source-planning core.
mod carve;
use geo::{
    BooleanOps, Buffer, Centroid, Contains, Coord, Intersects, LineString, MultiPolygon, Point,
    Polygon, TriangulateEarcut, Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use spade::FloatTriangulation;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub max_print_size_mm: [f64; 2],
    pub height_factor: f64,
    pub base_height_mm: f64,
    pub path_width_mm: f64,
    pub path_clearance_mm: f64,
    pub insert_depth_mm: f64,
    pub zone_insert_depth_mm: f64,
    pub zone_floor_mm: f64,
    pub ski_run_width_m: f64,
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
            zone_insert_depth_mm: 0.8,
            zone_floor_mm: 0.8,
            ski_run_width_m: 30.,
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
            self.zone_insert_depth_mm,
            self.zone_floor_mm,
            self.ski_run_width_m,
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
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ZoneSurface {
    #[default]
    Terrain,
    Level,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AreaPolygon {
    pub outer: Vec<[f64; 2]>,
    #[serde(default)]
    pub holes: Vec<Vec<[f64; 2]>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Feature {
    pub id: String,
    pub name: String,
    pub class: String,
    #[serde(default)]
    pub lines: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    pub polygons: Vec<AreaPolygon>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub treatment: Treatment,
    #[serde(default)]
    pub surface: ZoneSurface,
    #[serde(default)]
    pub width_m: Option<f64>,
    #[serde(default)]
    pub insert_depth_mm: Option<f64>,
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
    pub fn is_zone(&self) -> bool {
        !self.polygons.is_empty() || matches!(self.class.as_str(), "water" | "glacier" | "ski_run")
    }
}
fn yes() -> bool {
    true
}
fn zone_class(class: &str) -> bool {
    matches!(class, "water" | "glacier" | "ski_run")
}
fn default_treatment(class: &str) -> Treatment {
    if class == "ski_lift" {
        Treatment::VCarve
    } else {
        Treatment::Insert
    }
}
fn default_surface(class: &str) -> ZoneSurface {
    if class == "water" {
        ZoneSurface::Level
    } else {
        ZoneSurface::Terrain
    }
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
    if p.get("natural").and_then(Value::as_str) == Some("water")
        || p.get("landuse").and_then(Value::as_str) == Some("reservoir")
        || p.get("waterway").and_then(Value::as_str) == Some("riverbank")
    {
        return Some("water");
    }
    if p.get("natural").and_then(Value::as_str) == Some("glacier") {
        return Some("glacier");
    }
    if p.get("piste:type").and_then(Value::as_str) == Some("downhill") {
        return Some("ski_run");
    }
    if p.get("aerialway")
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty() && v != "no")
    {
        return Some("ski_lift");
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
fn parse_osm_line(value: &Value) -> Vec<[f64; 2]> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| Some([v["lon"].as_f64()?, v["lat"].as_f64()?]))
        .filter(|p| p[0].is_finite() && p[1].is_finite())
        .collect()
}
fn close_ring(mut ring: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    if ring.first() != ring.last() {
        if let Some(first) = ring.first().copied() {
            ring.push(first);
        }
    }
    ring
}
fn stitch_rings(mut parts: Vec<Vec<[f64; 2]>>) -> Vec<Vec<[f64; 2]>> {
    let mut rings = vec![];
    parts.retain(|p| p.len() >= 2);
    while let Some(mut ring) = parts.pop() {
        loop {
            if ring.len() >= 4 && ring.first() == ring.last() {
                break;
            }
            let Some(end) = ring.last().copied() else {
                break;
            };
            let found = parts.iter().enumerate().find_map(|(i, part)| {
                if part.first().copied() == Some(end) {
                    Some((i, false))
                } else if part.last().copied() == Some(end) {
                    Some((i, true))
                } else {
                    None
                }
            });
            let Some((i, reverse)) = found else {
                break;
            };
            let mut next = parts.swap_remove(i);
            if reverse {
                next.reverse();
            }
            ring.extend(next.into_iter().skip(1));
        }
        // Do not manufacture a polygon from an incomplete relation. Overpass
        // can return tainted geometry, and ski route relations can be open.
        if ring.len() >= 4 && ring.first() == ring.last() {
            rings.push(ring);
        }
    }
    rings
}
fn lonlat_polygon(area: &AreaPolygon) -> Polygon<f64> {
    let line =
        |ring: &[[f64; 2]]| LineString(ring.iter().map(|p| Coord { x: p[0], y: p[1] }).collect());
    Polygon::new(
        line(&area.outer),
        area.holes.iter().map(|r| line(r)).collect(),
    )
}
fn relation_polygons(members: &[Value]) -> Vec<AreaPolygon> {
    let mut outer_parts = vec![];
    let mut inner_parts = vec![];
    for member in members {
        let line = parse_osm_line(&member["geometry"]);
        if line.len() < 2 {
            continue;
        }
        if member["role"].as_str() == Some("inner") {
            inner_parts.push(line);
        } else {
            outer_parts.push(line);
        }
    }
    let mut areas: Vec<AreaPolygon> = stitch_rings(outer_parts)
        .into_iter()
        .map(|outer| AreaPolygon {
            outer,
            holes: vec![],
        })
        .collect();
    for hole in stitch_rings(inner_parts) {
        if let Some(point) = hole.first() {
            if let Some(area) = areas
                .iter_mut()
                .find(|a| lonlat_polygon(a).contains(&Point::new(point[0], point[1])))
            {
                area.holes.push(hole);
            }
        }
    }
    areas
}
fn geojson_polygons(g: &Value) -> Vec<AreaPolygon> {
    let area = |v: &Value| -> Option<AreaPolygon> {
        let rings = v.as_array()?;
        let outer = close_ring(parse_line(rings.first()?));
        if outer.len() < 4 {
            return None;
        }
        let holes = rings
            .iter()
            .skip(1)
            .map(parse_line)
            .map(close_ring)
            .filter(|r| r.len() >= 4)
            .collect();
        Some(AreaPolygon { outer, holes })
    };
    match g["type"].as_str() {
        Some("Polygon") => area(&g["coordinates"]).into_iter().collect(),
        Some("MultiPolygon") => g["coordinates"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(area)
            .collect(),
        _ => vec![],
    }
}
fn feature_from_parts(
    id: String,
    name: String,
    class: &str,
    lines: Vec<Vec<[f64; 2]>>,
    polygons: Vec<AreaPolygon>,
    tags: Value,
) -> Feature {
    Feature {
        id,
        name,
        class: class.into(),
        lines,
        polygons,
        enabled: true,
        treatment: default_treatment(class),
        surface: default_surface(class),
        width_m: None,
        insert_depth_mm: None,
        tags,
    }
}
pub fn normalize(input: &Value) -> Vec<Feature> {
    let mut out = vec![];
    if let Some(elements) = input.get("elements").and_then(Value::as_array) {
        let mut relation_members = HashSet::new();
        for e in elements.iter().filter(|e| e["type"] == "relation") {
            let Some(class) = classify(&e["tags"]) else {
                continue;
            };
            let members = e["members"].as_array().map(Vec::as_slice).unwrap_or(&[]);
            let polygons = relation_polygons(members);
            if polygons.is_empty() {
                continue;
            }
            for member in members {
                if let Some(id) = member["ref"].as_i64() {
                    relation_members.insert(id);
                }
            }
            let id = format!("osm:relation:{}", e["id"]);
            let name = e["tags"]["name"].as_str().unwrap_or(class).to_string();
            out.push(feature_from_parts(
                id,
                name,
                class,
                vec![],
                polygons,
                e["tags"].clone(),
            ));
        }
        for e in elements.iter().filter(|e| e["type"] == "way") {
            let Some(class) = classify(&e["tags"]) else {
                continue;
            };
            if e["id"]
                .as_i64()
                .is_some_and(|id| relation_members.contains(&id))
            {
                continue;
            }
            let line = parse_osm_line(&e["geometry"]);
            if line.len() < 2 {
                continue;
            }
            let closed = line.len() >= 4 && line.first() == line.last();
            let explicit_area = e["tags"]["area"].as_str() == Some("yes");
            let polygons = if zone_class(class) && (closed || explicit_area) {
                vec![AreaPolygon {
                    outer: close_ring(line.clone()),
                    holes: vec![],
                }]
            } else {
                vec![]
            };
            let lines = if polygons.is_empty() {
                vec![line]
            } else {
                vec![]
            };
            let id = format!("osm:way:{}", e["id"]);
            let name = e["tags"]["name"].as_str().unwrap_or(class).to_string();
            out.push(feature_from_parts(
                id,
                name,
                class,
                lines,
                polygons,
                e["tags"].clone(),
            ));
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
            let polygons = geojson_polygons(g);
            let lines = match g["type"].as_str() {
                Some("LineString") => vec![parse_line(&g["coordinates"])],
                Some("MultiLineString") => g["coordinates"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(parse_line)
                    .collect(),
                _ => vec![],
            };
            if polygons.is_empty() && lines.iter().all(|l| l.len() < 2) {
                continue;
            }
            let name = f["properties"]["Trail_Name"]
                .as_str()
                .or(f["properties"]["name"].as_str())
                .or(f["properties"]["tags"]["name"].as_str())
                .unwrap_or(class)
                .to_string();
            out.push(feature_from_parts(
                format!("upload:{i}"),
                name,
                class,
                lines,
                polygons,
                f["properties"].clone(),
            ));
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
                "Mesh is not a closed consistently oriented solid ({} vertices): {:?}",
                self.positions.len() / 3,
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
fn polygon_between_detail(
    poly: &Polygon<f64>,
    top: impl Fn([f64; 2]) -> f64,
    bottom: impl Fn([f64; 2]) -> f64,
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
    solid_between(pts, faces, top, bottom)
}
fn polygon_surface_detail(
    poly: &Polygon<f64>,
    top: impl Fn([f64; 2]) -> f64,
    base: f64,
    densify: bool,
) -> Mesh {
    polygon_between_detail(poly, top, |_| base, densify)
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
const CLASS_ORDER: [&str; 7] = [
    "water", "glacier", "ski_run", "trail", "road", "stream", "ski_lift",
];
fn model_polygon(area: &AreaPolygon, l: &Layout) -> Option<Polygon<f64>> {
    let ring = |points: &[[f64; 2]]| {
        LineString(
            points
                .iter()
                .map(|p| {
                    let p = l.xy(*p);
                    Coord { x: p[0], y: p[1] }
                })
                .collect(),
        )
    };
    let poly = Polygon::new(
        ring(&area.outer),
        area.holes.iter().map(|h| ring(h)).collect(),
    );
    (area.outer.len() >= 4 && poly.is_valid()).then_some(poly)
}
fn feature_polygon(
    f: &Feature,
    l: &Layout,
    s: &Settings,
    extra_width_mm: f64,
) -> MultiPolygon<f64> {
    let mut out = MultiPolygon(vec![]);
    for area in &f.polygons {
        if let Some(poly) = model_polygon(area, l) {
            out = out.union(&poly);
        }
    }
    let width = if f.class == "ski_run" {
        f.width_m.unwrap_or(s.ski_run_width_m) * l.scale
    } else {
        s.path_width_mm
    };
    for line in &f.lines {
        let ls = LineString(
            line.iter()
                .map(|p| {
                    let p = l.xy(*p);
                    Coord { x: p[0], y: p[1] }
                })
                .collect(),
        );
        out = out.union(&ls.buffer((width + extra_width_mm) / 2.));
    }
    out
}
fn feature_level(f: &Feature, g: &Grid, l: &Layout, poly: &Polygon<f64>) -> Option<f64> {
    if f.surface != ZoneSurface::Level {
        return None;
    }
    let mut level = f64::NEG_INFINITY;
    for c in &poly.exterior().0 {
        level = level.max(l.z(g, [c.x, c.y]));
    }
    for ring in poly.interiors() {
        for c in &ring.0 {
            level = level.max(l.z(g, [c.x, c.y]));
        }
    }
    if let Some(c) = poly.centroid() {
        level = level.max(l.z(g, [c.x(), c.y()]));
    }
    level.is_finite().then_some(level)
}
fn terrain_patch(
    poly: &Polygon<f64>,
    g: &Grid,
    l: &Layout,
    top: impl Fn([f64; 2]) -> f64,
    bottom: impl Fn([f64; 2]) -> f64,
) -> Result<Mesh, String> {
    use spade::Triangulation;
    let mut vertices = vec![];
    let mut edges = vec![];
    let mut add_ring = |ring: &LineString<f64>| {
        let start = vertices.len();
        let coords = &ring.0;
        let count = coords
            .len()
            .saturating_sub(usize::from(coords.first() == coords.last()));
        let mut dense = vec![];
        for index in 0..count {
            let a = coords[index];
            let b = coords[(index + 1) % count];
            let steps = (((b.x - a.x).hypot(b.y - a.y) / 0.6).ceil() as usize).max(1);
            for step in 0..steps {
                let f = step as f64 / steps as f64;
                dense.push([a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f]);
            }
        }
        for q in &dense {
            vertices.push(Vertex {
                p: spade::Point2::new(q[0], q[1]),
                z: l.z(g, *q),
            });
        }
        for i in 0..dense.len() {
            edges.push([start + i, start + (i + 1) % dense.len()]);
        }
    };
    add_ring(poly.exterior());
    for ring in poly.interiors() {
        add_ring(ring);
    }
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for c in &poly.exterior().0 {
        let q = l.lonlat([c.x, c.y]);
        bounds[0] = bounds[0].min(q[0]);
        bounds[1] = bounds[1].min(q[1]);
        bounds[2] = bounds[2].max(q[0]);
        bounds[3] = bounds[3].max(q[1]);
    }
    let index = |value: f64, min: f64, max: f64, count: usize| {
        (value - min) / (max - min) * (count - 1) as f64
    };
    let i0 = (index(bounds[0], g.bounds[0], g.bounds[2], g.width).floor() as isize - 1)
        .clamp(0, g.width as isize - 1) as usize;
    let i1 = (index(bounds[2], g.bounds[0], g.bounds[2], g.width).ceil() as isize + 1)
        .clamp(0, g.width as isize - 1) as usize;
    let j0 = (index(bounds[1], g.bounds[1], g.bounds[3], g.height).floor() as isize - 1)
        .clamp(0, g.height as isize - 1) as usize;
    let j1 = (index(bounds[3], g.bounds[1], g.bounds[3], g.height).ceil() as isize + 1)
        .clamp(0, g.height as isize - 1) as usize;
    for j in j0..=j1 {
        for i in i0..=i1 {
            let q = l.xy([
                g.bounds[0] + i as f64 / (g.width - 1) as f64 * (g.bounds[2] - g.bounds[0]),
                g.bounds[1] + j as f64 / (g.height - 1) as f64 * (g.bounds[3] - g.bounds[1]),
            ]);
            if poly.contains(&Point::new(q[0], q[1])) {
                vertices.push(Vertex {
                    p: spade::Point2::new(q[0], q[1]),
                    z: l.z(g, q),
                });
            }
        }
    }
    let dt = spade::ConstrainedDelaunayTriangulation::<Vertex>::bulk_load_cdt(vertices, edges)
        .map_err(|e| format!("Could not triangulate conformal zone: {e:?}"))?;
    let points: Vec<[f64; 2]> = dt
        .vertices()
        .map(|v| [v.position().x, v.position().y])
        .collect();
    let mut seen = HashSet::new();
    let faces = dt
        .inner_faces()
        .filter_map(|f| {
            let v = f.vertices();
            let face = [
                v[0].fix().index() as u32,
                v[1].fix().index() as u32,
                v[2].fix().index() as u32,
            ];
            let a = points[face[0] as usize];
            let b = points[face[1] as usize];
            let c = points[face[2] as usize];
            let center = Point::new((a[0] + b[0] + c[0]) / 3., (a[1] + b[1] + c[1]) / 3.);
            let mut key = face;
            key.sort_unstable();
            (poly.contains(&center) && seen.insert(key)).then_some(face)
        })
        .collect();
    Ok(solid_between(points, faces, top, bottom))
}
fn feature_boundary(s: &Settings, l: &Layout) -> MultiPolygon<f64> {
    let b = if s.boundary.len() >= 3 {
        polygon(&s.boundary.iter().map(|p| l.xy(*p)).collect::<Vec<_>>())
    } else {
        rectangle(l.width, l.depth)
    };
    b.buffer(-s.path_clearance_mm.max(0.15))
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
    let mut occupied_inserts = MultiPolygon(vec![]);
    let mut out = vec![];
    for class in CLASS_ORDER {
        let mut inserts = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() == Treatment::Insert)
        {
            inserts = inserts.union(&feature_polygon(f, l, s, 0.));
        }
        let allowed =
            clip.difference(&occupied_inserts.union(&inserts.buffer(s.path_clearance_mm / 2.)));
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() != Treatment::Hide)
        {
            let footprint = feature_polygon(f, l, s, 0.);
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
                    if f.is_zone() {
                        let level = feature_level(f, g, l, p);
                        if let Some(level) = level {
                            preview_ribbon(p, |_| level - s.carve_depth_mm)
                        } else {
                            terrain_patch(
                                p,
                                g,
                                l,
                                |q| l.z(g, q) - s.carve_depth_mm + 0.02,
                                |q| l.z(g, q) - s.carve_depth_mm,
                            )?
                        }
                    } else {
                        carve::surface(
                            carve::mesh(g, s, f, l, p, 10000., false)
                                .map_err(|e| format!("{} groove: {e}", f.id))?,
                        )
                    }
                } else {
                    let level = feature_level(f, g, l, p);
                    if let Some(level) = level {
                        preview_ribbon(p, |_| level)
                    } else if f.is_zone() {
                        terrain_patch(p, g, l, |q| l.z(g, q) + 0.35, |q| l.z(g, q))?
                    } else {
                        preview_ribbon(p, |q| l.z(g, q))
                    }
                };
                out.push(Overlay {
                    treatment: f.treatment(),
                    id: format!("{}#{i}", f.id),
                    class: f.class.clone(),
                    mesh,
                });
            }
        }
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
    #[serde(default)]
    pub conformal: bool,
}
#[derive(Serialize, Deserialize)]
pub struct Plan {
    pub inserts: Vec<Piece>,
    pub cutters: Vec<Mesh>,
}
fn add_insert_layer(
    out: &mut Plan,
    g: &Grid,
    s: &Settings,
    l: &Layout,
    class: &str,
    layer: &MultiPolygon<f64>,
    feature: Option<&Feature>,
    seg: [f64; 2],
    roof: f64,
    serial: &mut usize,
) -> Result<(), String> {
    let zone = feature.is_some_and(Feature::is_zone);
    let depth = feature.and_then(|f| f.insert_depth_mm).unwrap_or(if zone {
        s.zone_insert_depth_mm
    } else {
        s.insert_depth_mm
    });
    let floor = if zone { s.zone_floor_mm } else { 0.4 };
    // A level zone keeps one elevation across segmentation cells, so splitting a
    // large reservoir for a smaller bed never creates visible steps.
    let fixed_level = feature.and_then(|f| {
        layer
            .0
            .iter()
            .filter_map(|p| feature_level(f, g, l, p))
            .max_by(f64::total_cmp)
    });
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
            let parts = layer
                .intersection(&cell.buffer(-s.insert_gap_mm / 2.))
                .buffer(-0.001)
                .buffer(0.001);
            if parts.0.is_empty() {
                continue;
            }
            let top = |q| fixed_level.unwrap_or_else(|| l.z(g, q)) + 0.35;
            let mut base = f64::INFINITY;
            for pocket in &pockets.0 {
                for c in &pocket.exterior().0 {
                    base = base.min(top([c.x, c.y]) - depth);
                }
                for ring in pocket.interiors() {
                    for c in &ring.0 {
                        base = base.min(top([c.x, c.y]) - depth);
                    }
                }
            }
            if !base.is_finite() {
                continue;
            }
            base = base.max(floor + 0.15);
            for (i, part) in parts.0.iter().enumerate() {
                // Terrain-following inserts are emitted as simple prisms here.
                // The browser solid engine intersects each prism with the
                // original terrain shifted upward by the visible protrusion.
                // That reuses the exact terrain triangles and avoids a second,
                // independently triangulated surface along the zone boundary.
                let conformal = zone && fixed_level.is_none();
                let mut mesh = if conformal {
                    polygon_surface(part, |_| roof, base)
                } else {
                    polygon_surface(part, top, base)
                };
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
                *serial += 1;
                out.inserts.push(Piece {
                    id: format!("{class}-z{}-r{}-c{}-{}", *serial, row + 1, col + 1, i + 1),
                    class: class.into(),
                    mesh,
                    origin,
                    conformal,
                });
            }
            for pocket in pockets.buffer(s.path_clearance_mm / 2.).0 {
                let cutter =
                    polygon_surface_detail(&pocket, |_| roof, (base - 0.15).max(floor), false);
                cutter
                    .validate()
                    .map_err(|e| format!("{class} pocket {row},{col}: {e}"))?;
                out.cutters.push(cutter);
            }
        }
    }
    Ok(())
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
    let roof = (g
        .elevations
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max)
        - l.minimum)
        * l.scale
        * l.height_factor
        + l.base_height
        + 5.;
    let mut serial = 0;
    for class in CLASS_ORDER {
        let occupied_before = occupied.clone();
        let mut union = MultiPolygon(vec![]);
        let insert_features: Vec<_> = features
            .iter()
            .filter(|f| f.treatment() == Treatment::Insert && f.class == class)
            .collect();
        for f in &insert_features {
            union = union.union(&feature_polygon(f, l, s, 0.));
        }
        let layer = union.intersection(&clip).difference(&occupied);
        let protected = occupied_inserts
            .union(&layer)
            .buffer((s.path_clearance_mm / 2. - 0.002).max(0.));
        let allowed = clip.difference(&protected);
        let mut carved = MultiPolygon(vec![]);
        for f in features
            .iter()
            .filter(|f| f.class == class && f.treatment() == Treatment::VCarve)
        {
            let domain = feature_polygon(f, l, s, 0.002)
                .buffer(-0.001)
                .buffer(0.001)
                .intersection(&allowed);
            for p in &domain.0 {
                let mesh = if f.is_zone() {
                    polygon_between_detail(
                        p,
                        |_| roof,
                        |q| (l.z(g, q) - s.carve_depth_mm).max(s.zone_floor_mm),
                        true,
                    )
                } else {
                    carve::mesh(g, s, f, l, p, roof, true)?
                };
                mesh.validate()
                    .map_err(|e| format!("{} recess: {e}", f.id))?;
                out.cutters.push(mesh);
            }
            carved = carved.union(&domain);
        }
        if zone_class(class) {
            let mut claimed = MultiPolygon(vec![]);
            for f in insert_features {
                let individual = feature_polygon(f, l, s, 0.)
                    .intersection(&clip)
                    .difference(&occupied_before)
                    .intersection(&layer)
                    .difference(&claimed);
                add_insert_layer(
                    &mut out,
                    g,
                    s,
                    l,
                    class,
                    &individual,
                    Some(f),
                    seg,
                    roof,
                    &mut serial,
                )?;
                claimed = claimed.union(&individual);
            }
        } else {
            add_insert_layer(
                &mut out,
                g,
                s,
                l,
                class,
                &layer,
                None,
                seg,
                roof,
                &mut serial,
            )?;
        }
        occupied = occupied.union(&layer).union(&carved);
        occupied_inserts = occupied_inserts.union(&layer);
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
pub fn overpass_query(b: [f64; 4], winter: bool) -> Result<String, String> {
    validate_bounds(b)?;
    let bbox = format!("({},{},{},{})", b[1], b[0], b[3], b[2]);
    let winter_query = if winter {
        format!("way[\"piste:type\"=\"downhill\"]{bbox};relation[\"piste:type\"=\"downhill\"]{bbox};way[aerialway]{bbox};")
    } else {
        String::new()
    };
    Ok(format!("[out:json][timeout:45];(way[highway~\"^(path|footway|bridleway|cycleway|track|motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street)$\"]{bbox};way[waterway~\"^(river|stream|drain|ditch)$\"]{bbox};way[natural=water]{bbox};relation[natural=water][type=multipolygon]{bbox};way[landuse=reservoir]{bbox};relation[landuse=reservoir][type=multipolygon]{bbox};way[waterway=riverbank]{bbox};relation[waterway=riverbank][type=multipolygon]{bbox};way[natural=glacier]{bbox};relation[natural=glacier][type=multipolygon]{bbox};{winter_query});out body geom;"))
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
