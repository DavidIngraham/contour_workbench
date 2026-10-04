#![warn(missing_docs)]
//! Contour Workbench's platform-independent geometry and source-planning core.
//!
//! Geographic inputs use `[longitude, latitude]` pairs in decimal degrees. Generated
//! geometry uses millimeters in the printer coordinate system.
mod carve;
mod model;
pub use model::{Layout, Mesh, Overlay, Piece, Plan};
#[cfg(test)]
mod contract_tests;
use geo::{
    BooleanOps, BoundingRect, Buffer, Centroid, Contains, Coord, Intersects, LineString,
    MultiPolygon, Point, Polygon, TriangulateEarcut, Validation,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use spade::FloatTriangulation;
use std::collections::{HashMap, HashSet};

/// Manufacturing strategy for removable inserts or aligned multicolor parts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ManufacturingMode {
    /// Tapered removable inserts with configurable fit clearance.
    #[default]
    Separate,
    /// Aligned parts printed together with a shared, clearance-free interface.
    Multicolor,
}
/// Visible insert-top placement relative to the sampled terrain surface.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InsertSurfaceMode {
    /// Raise insert tops above terrain by the configured proud height.
    #[default]
    Proud,
    /// Align insert tops with the sampled terrain surface.
    Flush,
    /// Lower insert tops below terrain by the configured inset depth.
    Inset,
}
/// Validated controls that affect terrain, overlays, inserts, and pockets.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Manufacturing strategy for insert geometry.
    pub manufacturing_mode: ManufacturingMode,
    /// Visible insert-top placement relative to sampled terrain.
    pub insert_surface_mode: InsertSurfaceMode,
    /// Height of proud insert tops above sampled terrain, in millimeters.
    pub insert_proud_height_mm: f64,
    /// Depth of inset insert tops below sampled terrain, in millimeters.
    pub insert_inset_depth_mm: f64,
    /// Maximum printable width and depth in millimeters.
    pub max_print_size_mm: [f64; 2],
    /// Multiplier applied to terrain relief after horizontal scaling.
    pub height_factor: f64,
    /// Solid base thickness below the lowest terrain point, in millimeters.
    pub base_height_mm: f64,
    /// Default finished width of linear features, in millimeters.
    pub path_width_mm: f64,
    /// Extra path-pocket clearance per side, in millimeters.
    pub path_clearance_mm: f64,
    /// Minimum intact terrain margin between features and the model edge, in millimeters.
    pub feature_edge_clearance_mm: f64,
    /// Printer nozzle diameter used for minimum-feature calculations, in millimeters.
    pub nozzle_diameter_mm: f64,
    /// Optional minimum retained terrain-island width, in millimeters.
    pub minimum_terrain_island_width_mm: Option<f64>,
    /// Pocket clearance added on each side of an insert, in millimeters.
    pub insert_fit_clearance_per_side_mm: f64,
    /// Lower-edge inset used to compensate for elephant foot, in millimeters.
    pub insert_elephant_foot_relief_mm: f64,
    /// Height over which elephant-foot relief is applied, in millimeters.
    pub insert_elephant_foot_height_mm: f64,
    /// Assembly draft applied to buried insert walls, in degrees.
    pub insert_draft_angle_deg: f64,
    /// Default depth of line-feature inserts, in millimeters.
    pub insert_depth_mm: f64,
    /// Default depth of polygon-zone inserts, in millimeters.
    pub zone_insert_depth_mm: f64,
    /// Minimum terrain floor retained below large zone inserts, in millimeters.
    pub zone_floor_mm: f64,
    /// Ground width assigned to centerline ski runs, in meters.
    pub ski_run_width_m: f64,
    /// Maximum V-carve depth, in millimeters.
    pub carve_depth_mm: f64,
    /// Separation between independently printable insert parts, in millimeters.
    pub insert_gap_mm: f64,
    /// Optional square segmentation size for inserts, in millimeters.
    pub insert_segment_size_mm: Option<f64>,
    /// Maximum sampled vertical error for adaptive terrain; zero preserves full resolution.
    pub terrain_max_error_mm: f64,
    /// Optional terrain boundary as longitude/latitude vertices.
    pub boundary: Vec<[f64; 2]>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            manufacturing_mode: ManufacturingMode::Separate,
            insert_surface_mode: InsertSurfaceMode::Proud,
            insert_proud_height_mm: 0.35,
            insert_inset_depth_mm: 0.3,
            max_print_size_mm: [248., 198.],
            height_factor: 1.,
            base_height_mm: 1.,
            path_width_mm: 0.9,
            path_clearance_mm: 0.1,
            feature_edge_clearance_mm: 1.,
            nozzle_diameter_mm: 0.4,
            minimum_terrain_island_width_mm: None,
            insert_fit_clearance_per_side_mm: 0.15,
            insert_elephant_foot_relief_mm: 0.18,
            insert_elephant_foot_height_mm: 0.4,
            insert_draft_angle_deg: 1.5,
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
/// Return `[west, south, east, north]` for longitude/latitude vertices.
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
    /// Return the lateral pocket clearance used by this manufacturing strategy.
    pub fn effective_insert_clearance_mm(&self) -> f64 {
        match self.manufacturing_mode {
            ManufacturingMode::Separate => self.insert_fit_clearance_per_side_mm,
            ManufacturingMode::Multicolor => 0.,
        }
    }
    /// Return the separation between independently printable insert sections.
    pub fn effective_insert_gap_mm(&self) -> f64 {
        match self.manufacturing_mode {
            ManufacturingMode::Separate => self.insert_gap_mm,
            ManufacturingMode::Multicolor => 0.,
        }
    }
    /// Return the signed visible insert-top offset from sampled terrain.
    pub fn insert_surface_offset_mm(&self) -> f64 {
        match self.insert_surface_mode {
            InsertSurfaceMode::Proud => self.insert_proud_height_mm,
            InsertSurfaceMode::Flush => 0.,
            InsertSurfaceMode::Inset => -self.insert_inset_depth_mm,
        }
    }
    /// Return the pocket floor for an insert whose lower surface is at the given base.
    pub fn insert_pocket_bottom_mm(&self, base: f64, floor: f64) -> f64 {
        match self.manufacturing_mode {
            ManufacturingMode::Separate => (base - 0.15).max(floor),
            ManufacturingMode::Multicolor => base,
        }
    }
    /// Return the configured island width or the nozzle-derived default.
    pub fn effective_minimum_terrain_island_width_mm(&self) -> f64 {
        self.minimum_terrain_island_width_mm
            .unwrap_or(self.nozzle_diameter_mm * 1.125 * 3.)
    }
    /// Validate dimensions, compensation ranges, and boundary topology.
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
            self.feature_edge_clearance_mm,
            self.nozzle_diameter_mm,
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
        for v in [
            self.insert_fit_clearance_per_side_mm,
            self.insert_elephant_foot_relief_mm,
            self.insert_elephant_foot_height_mm,
            self.insert_draft_angle_deg,
            self.insert_proud_height_mm,
            self.insert_inset_depth_mm,
            self.terrain_max_error_mm,
        ] {
            if !v.is_finite() || v < 0. {
                return Err("Compensation values must be finite and nonnegative".into());
            }
        }
        if self.nozzle_diameter_mm > 2.
            || self.insert_fit_clearance_per_side_mm > 2.
            || self.insert_elephant_foot_relief_mm > 2.
            || self.insert_elephant_foot_height_mm > 5.
            || self.insert_draft_angle_deg > 10.
            || self.insert_proud_height_mm > 10.
            || self.insert_inset_depth_mm > 10.
        {
            return Err("Insert compensation is outside the supported range".into());
        }
        if self.feature_edge_clearance_mm > 20. {
            return Err("Feature edge clearance must not exceed 20 mm".into());
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
        if self
            .minimum_terrain_island_width_mm
            .is_some_and(|x| !x.is_finite() || !(0. ..=20.).contains(&x))
        {
            return Err("Minimum terrain island width must be between 0 and 20 mm".into());
        }
        Ok(())
    }
}
/// Rectilinear elevation samples covering a geographic bounding box.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Grid {
    /// Geographic bounds as `[west, south, east, north]`.
    pub bounds: [f64; 4],
    /// Number of samples along the longitude axis.
    pub width: usize,
    /// Number of samples along the latitude axis.
    pub height: usize,
    /// Row-major elevations in meters above the source datum.
    pub elevations: Vec<f64>,
}
impl Grid {
    /// Validate grid dimensions, bounds, sample count, and finite elevations.
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
    /// Bilinearly sample the grid at a longitude and latitude.
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
/// Validate supported geographic bounds and reject dateline crossings.
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
/// Geometry treatment selected for a feature.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Treatment {
    /// Create a separately printable insert and matching pocket.
    #[default]
    Insert,
    /// Exclude the feature from preview and generated geometry.
    Hide,
    /// Cut a terrain-following V-shaped groove.
    VCarve,
}
/// Surface policy for a polygon-zone insert.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ZoneSurface {
    /// Follow the terrain surface.
    #[default]
    Terrain,
    /// Use one level elevation across the zone.
    Level,
}
/// Polygon-zone geometry with optional interior holes.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AreaPolygon {
    /// Closed exterior ring as longitude/latitude vertices.
    pub outer: Vec<[f64; 2]>,
    #[serde(default)]
    /// Closed interior rings as longitude/latitude vertices.
    pub holes: Vec<Vec<[f64; 2]>>,
}
/// Normalized line or polygon feature imported from OSM or GeoJSON.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Feature {
    /// Stable source identifier used by the feature tree and preset overlays.
    pub id: String,
    /// User-facing feature name.
    pub name: String,
    /// Classification such as `trail`, `water`, or `ski_run`.
    pub class: String,
    #[serde(default)]
    /// Line strings as longitude/latitude vertices.
    pub lines: Vec<Vec<[f64; 2]>>,
    #[serde(default)]
    /// Polygon geometry for area features.
    pub polygons: Vec<AreaPolygon>,
    #[serde(default = "yes")]
    /// Whether the feature participates in preview and generation.
    pub enabled: bool,
    #[serde(default)]
    /// Selected geometry treatment when enabled.
    pub treatment: Treatment,
    #[serde(default)]
    /// Surface policy used by polygon-zone inserts.
    pub surface: ZoneSurface,
    #[serde(default)]
    /// Optional source-ground width override in meters.
    pub width_m: Option<f64>,
    #[serde(default)]
    /// Optional insert-depth override in millimeters.
    pub insert_depth_mm: Option<f64>,
    #[serde(default)]
    /// Original source properties retained for inspection and round trips.
    pub tags: Value,
}
impl Feature {
    /// Return the effective treatment, accounting for visibility.
    pub fn treatment(&self) -> Treatment {
        if self.enabled {
            self.treatment
        } else {
            Treatment::Hide
        }
    }
    /// Return whether this feature should be handled as an area zone.
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
/// Classify source properties into a supported Contour Workbench feature class.
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
/// Normalize an Overpass response or GeoJSON feature collection.
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
fn printable_parts(parts: MultiPolygon<f64>, nozzle_diameter_mm: f64) -> MultiPolygon<f64> {
    let limit = (nozzle_diameter_mm * 0.15).clamp(0.02, 0.08);
    let mut last = parts.clone();
    for epsilon in [0.001, 0.005, 0.02, limit] {
        let candidate = parts.buffer(-epsilon).buffer((epsilon - 0.001).max(0.));
        if candidate.0.is_empty() {
            continue;
        }
        let printable = candidate
            .0
            .iter()
            .all(|part| polygon_surface(part, |_| 1., 0.).validate().is_ok());
        if printable {
            return candidate;
        }
        last = candidate;
    }
    last
}
fn remove_unprintable_terrain_islands(
    pocket: &Polygon<f64>,
    minimum_width_mm: f64,
) -> (Polygon<f64>, usize) {
    if minimum_width_mm <= 0. {
        return (pocket.clone(), 0);
    }
    let mut removed = 0;
    let interiors = pocket
        .interiors()
        .iter()
        .filter_map(|ring| {
            let island = Polygon::new(ring.clone(), vec![]);
            if island.buffer(-minimum_width_mm / 2.).0.is_empty() {
                removed += 1;
                None
            } else {
                Some(ring.clone())
            }
        })
        .collect();
    (Polygon::new(pocket.exterior().clone(), interiors), removed)
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
/// Generated terrain solid and the layout used to construct it.
#[derive(Serialize, Deserialize)]
pub struct Terrain {
    /// Closed terrain mesh.
    pub mesh: Mesh,
    /// Geographic-to-model transformation for this terrain.
    pub layout: Layout,
    /// Number of elevation samples in the source grid.
    pub source_samples: usize,
    /// Number of elevation samples retained after optional simplification.
    pub retained_samples: usize,
}
/// Build a closed terrain solid from an elevation grid and validated settings.
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
    const TILE_CELLS: usize = 128;
    let mut faces = vec![];
    if s.terrain_max_error_mm > 0. {
        let (points, adaptive_faces) = adaptive(&pts, g, s.terrain_max_error_mm, &l)?;
        pts = points;
        faces = adaptive_faces;
    } else {
        for tile_y in (0..g.height - 1).step_by(TILE_CELLS) {
            for tile_x in (0..g.width - 1).step_by(TILE_CELLS) {
                let end_y = (tile_y + TILE_CELLS).min(g.height - 1);
                let end_x = (tile_x + TILE_CELLS).min(g.width - 1);
                for j in tile_y..end_y {
                    for i in tile_x..end_x {
                        let a = (j * g.width + i) as u32;
                        faces.extend([
                            [a, a + 1, a + g.width as u32 + 1],
                            [a, a + g.width as u32 + 1, a + g.width as u32],
                        ]);
                    }
                }
            }
        }
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
type TerrainTriangulation = (Vec<[f64; 2]>, Vec<[u32; 3]>);

fn adaptive(
    pts: &[[f64; 2]],
    g: &Grid,
    tol: f64,
    l: &Layout,
) -> Result<TerrainTriangulation, String> {
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
fn feature_boundary(s: &Settings, l: &Layout, additional_clearance_mm: f64) -> MultiPolygon<f64> {
    let boundary = if s.boundary.len() >= 3 {
        polygon(&s.boundary.iter().map(|p| l.xy(*p)).collect::<Vec<_>>())
    } else {
        rectangle(l.width, l.depth)
    };
    boundary.buffer(-(s.feature_edge_clearance_mm + additional_clearance_mm.max(0.)))
}
const INSERT_PREVIEW_THICKNESS_MM: f64 = 0.35;
const INSERT_SUBSTRATE_CLEARANCE_MM: f64 = 0.15;
const MINIMUM_INSERT_THICKNESS_MM: f64 = 0.05;

fn minimum_insert_surface(
    poly: &Polygon<f64>,
    g: &Grid,
    l: &Layout,
    fixed_level: Option<f64>,
) -> f64 {
    if let Some(level) = fixed_level {
        return level;
    }
    let mut minimum = std::iter::once(poly.exterior())
        .chain(poly.interiors())
        .flat_map(|ring| ring.0.iter())
        .map(|point| l.z(g, [point.x, point.y]))
        .fold(f64::INFINITY, f64::min);
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for coordinate in &poly.exterior().0 {
        let point = l.lonlat([coordinate.x, coordinate.y]);
        bounds[0] = bounds[0].min(point[0]);
        bounds[1] = bounds[1].min(point[1]);
        bounds[2] = bounds[2].max(point[0]);
        bounds[3] = bounds[3].max(point[1]);
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
            let point = l.xy([
                g.bounds[0] + i as f64 / (g.width - 1) as f64 * (g.bounds[2] - g.bounds[0]),
                g.bounds[1] + j as f64 / (g.height - 1) as f64 * (g.bounds[3] - g.bounds[1]),
            ]);
            if poly.contains(&Point::new(point[0], point[1])) {
                minimum = minimum.min(l.z(g, point));
            }
        }
    }
    minimum
}

fn effective_insert_surface_offset(
    minimum_surface_mm: f64,
    requested_offset_mm: f64,
    floor_mm: f64,
) -> f64 {
    requested_offset_mm.max(
        floor_mm + INSERT_SUBSTRATE_CLEARANCE_MM + MINIMUM_INSERT_THICKNESS_MM - minimum_surface_mm,
    )
}

// Preview ribbons follow the requested visible surface instead of extending to the model base.
fn preview_ribbon(
    poly: &Polygon<f64>,
    surface: impl Fn([f64; 2]) -> f64,
    surface_offset_mm: f64,
) -> Mesh {
    let mut mesh = polygon_surface(poly, |p| surface(p) + surface_offset_mm, 0.);
    let half = mesh.positions.len() / 2;
    for i in (half..mesh.positions.len()).step_by(3) {
        mesh.positions[i + 2] = mesh.positions[i - half + 2] - INSERT_PREVIEW_THICKNESS_MM;
    }
    mesh
}
/// Build feature preview meshes without running final solid booleans.
pub fn overlays(
    g: &Grid,
    s: &Settings,
    features: &[Feature],
    l: &Layout,
) -> Result<Vec<Overlay>, String> {
    s.validate()?;
    let clip = feature_boundary(s, l, 0.);
    let insert_clip = feature_boundary(s, l, s.insert_fit_clearance_per_side_mm);
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
        inserts = inserts.intersection(&insert_clip);
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
                &insert_clip
            });
            for (i, p) in polygons.0.iter().enumerate() {
                let (mesh, surface_offset_mm) = if f.treatment() == Treatment::VCarve {
                    let mesh = if f.is_zone() {
                        let level = feature_level(f, g, l, p);
                        if let Some(level) = level {
                            preview_ribbon(
                                p,
                                |_| level - s.carve_depth_mm,
                                INSERT_PREVIEW_THICKNESS_MM,
                            )
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
                    };
                    (mesh, 0.)
                } else {
                    let floor = if f.is_zone() { s.zone_floor_mm } else { 0.4 };
                    let requested_offset = s.insert_surface_offset_mm();
                    let level = feature_level(f, g, l, p);
                    let surface_offset = effective_insert_surface_offset(
                        minimum_insert_surface(p, g, l, level),
                        requested_offset,
                        floor,
                    );
                    let mesh = if let Some(level) = level {
                        preview_ribbon(p, |_| level, surface_offset)
                    } else if f.is_zone() {
                        terrain_patch(
                            p,
                            g,
                            l,
                            |q| l.z(g, q) + surface_offset,
                            |q| l.z(g, q) + surface_offset - INSERT_PREVIEW_THICKNESS_MM,
                        )?
                    } else {
                        preview_ribbon(p, |q| l.z(g, q), surface_offset)
                    };
                    (mesh, surface_offset)
                };
                out.push(Overlay {
                    treatment: f.treatment(),
                    id: format!("{}#{i}", f.id),
                    class: f.class.clone(),
                    surface_offset_mm,
                    mesh,
                });
            }
        }
        occupied_inserts = occupied_inserts.union(&inserts);
    }
    Ok(out)
}
#[derive(Clone)]
struct PocketSurface {
    polygon: Polygon<f64>,
    height_mm: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PocketTerrainStrategy {
    Direct,
    BoundedCutters,
}

fn classify_pocket_topology(pockets: &[PocketSurface]) -> PocketTerrainStrategy {
    struct BoundedPocket {
        index: usize,
        min_x: f64,
        max_x: f64,
        min_y: f64,
        max_y: f64,
    }

    let mut bounded = pockets
        .iter()
        .enumerate()
        .filter_map(|(index, pocket)| {
            let bounds = pocket.polygon.bounding_rect()?;
            Some(BoundedPocket {
                index,
                min_x: bounds.min().x,
                max_x: bounds.max().x,
                min_y: bounds.min().y,
                max_y: bounds.max().y,
            })
        })
        .collect::<Vec<_>>();
    bounded.sort_by(|left, right| {
        left.min_x
            .total_cmp(&right.min_x)
            .then_with(|| left.index.cmp(&right.index))
    });

    // Same-height overlaps are unioned before direct meshing. Different-height
    // overlaps or shared boundaries require interface junction topology that the
    // direct mesher cannot yet guarantee. An x-sorted bounding-box sweep keeps
    // this preflight cheap for presets with hundreds of independent pockets.
    const EPSILON: f64 = 1e-9;
    for (position, left) in bounded.iter().enumerate() {
        for right in &bounded[position + 1..] {
            if right.min_x > left.max_x + EPSILON {
                break;
            }
            if right.min_y > left.max_y + EPSILON || left.min_y > right.max_y + EPSILON {
                continue;
            }
            let left_pocket = &pockets[left.index];
            let right_pocket = &pockets[right.index];
            if (left_pocket.height_mm - right_pocket.height_mm).abs() < EPSILON {
                continue;
            }
            if left_pocket.polygon.intersects(&right_pocket.polygon) {
                return PocketTerrainStrategy::BoundedCutters;
            }
        }
    }
    PocketTerrainStrategy::Direct
}

#[cfg(test)]
mod pocket_topology_tests {
    use super::*;

    fn pocket(points: &[[f64; 2]], height_mm: f64) -> PocketSurface {
        PocketSurface {
            polygon: polygon(points),
            height_mm,
        }
    }

    #[test]
    fn safe_disjoint_and_same_height_topology_uses_direct_mesh() {
        let pockets = vec![
            pocket(&[[0., 0.], [2., 0.], [2., 2.], [0., 2.]], 1.),
            pocket(&[[1., 0.], [3., 0.], [3., 2.], [1., 2.]], 1.),
            pocket(&[[4., 0.], [6., 0.], [6., 2.], [4., 2.]], 2.),
        ];
        assert_eq!(
            classify_pocket_topology(&pockets),
            PocketTerrainStrategy::Direct
        );
    }

    #[test]
    fn multi_height_overlap_or_shared_junction_uses_bounded_cutters() {
        let overlapping = vec![
            pocket(&[[0., 0.], [2., 0.], [2., 2.], [0., 2.]], 1.),
            pocket(&[[1., 1.], [3., 1.], [3., 3.], [1., 3.]], 2.),
        ];
        assert_eq!(
            classify_pocket_topology(&overlapping),
            PocketTerrainStrategy::BoundedCutters
        );

        let touching = vec![
            pocket(&[[0., 0.], [2., 0.], [2., 2.], [0., 2.]], 1.),
            pocket(&[[2., 2.], [4., 2.], [4., 4.], [2., 4.]], 2.),
        ];
        assert_eq!(
            classify_pocket_topology(&touching),
            PocketTerrainStrategy::BoundedCutters
        );
    }
}

fn normalized_pocket_surfaces(mut pockets: Vec<PocketSurface>) -> Vec<PocketSurface> {
    pockets.sort_by(|a, b| a.height_mm.total_cmp(&b.height_mm));
    let mut claimed = MultiPolygon(vec![]);
    let mut result = vec![];
    let mut index = 0;
    while index < pockets.len() {
        let height = pockets[index].height_mm;
        let mut same_height = MultiPolygon(vec![]);
        while index < pockets.len() && (pockets[index].height_mm - height).abs() < 1e-9 {
            same_height = same_height.union(&pockets[index].polygon);
            index += 1;
        }
        let visible = same_height.difference(&claimed);
        for polygon in visible {
            result.push(PocketSurface {
                polygon,
                height_mm: height,
            });
        }
        claimed = claimed.union(&same_height);
    }
    result
}

fn feature_aware_terrain(
    base: &Terrain,
    g: &Grid,
    s: &Settings,
    l: &Layout,
    pockets: &[PocketSurface],
) -> Result<Mesh, String> {
    use spade::Triangulation;
    let pockets = normalized_pocket_surfaces(pockets.to_vec());
    let boundary = if s.boundary.len() >= 3 {
        polygon(
            &s.boundary
                .iter()
                .map(|point| l.xy(*point))
                .collect::<Vec<_>>(),
        )
    } else {
        rectangle(l.width, l.depth)
    };

    let mut vertices: Vec<Vertex> = vec![];
    let mut vertex_map: HashMap<(i64, i64), usize> = HashMap::new();
    let mut constraints: Vec<[usize; 2]> = vec![];
    let mut constraint_set = HashSet::new();
    let add_point = |point: [f64; 2],
                     vertices: &mut Vec<Vertex>,
                     vertex_map: &mut HashMap<(i64, i64), usize>| {
        let key = (
            (point[0] * 1e7).round() as i64,
            (point[1] * 1e7).round() as i64,
        );
        *vertex_map.entry(key).or_insert_with(|| {
            let index = vertices.len();
            vertices.push(Vertex {
                p: spade::Point2::new(point[0], point[1]),
                z: l.z(g, point),
            });
            index
        })
    };
    let mut add_ring = |ring: &LineString<f64>| {
        let coordinates = &ring.0;
        let count = coordinates
            .len()
            .saturating_sub(usize::from(coordinates.first() == coordinates.last()));
        let mut ring_vertices = vec![];
        for coordinate in coordinates.iter().take(count) {
            let vertex = add_point([coordinate.x, coordinate.y], &mut vertices, &mut vertex_map);
            if ring_vertices.last() != Some(&vertex) {
                ring_vertices.push(vertex);
            }
        }
        for index in 0..ring_vertices.len() {
            let a = ring_vertices[index];
            let b = ring_vertices[(index + 1) % ring_vertices.len()];
            if a != b && constraint_set.insert((a.min(b), a.max(b))) {
                constraints.push([a, b]);
            }
        }
    };
    add_ring(boundary.exterior());
    for pocket in &pockets {
        add_ring(pocket.polygon.exterior());
        for ring in pocket.polygon.interiors() {
            add_ring(ring);
        }
    }

    // Normalize overlapping/touching polygon linework in a small CDT first. The
    // bulk loader accepts the nonconflicting majority; only rejected overlaps
    // take the more expensive split path.
    let mut conflicts = vec![];
    let mut boundary_triangulation =
        spade::ConstrainedDelaunayTriangulation::<Vertex>::try_bulk_load_cdt(
            vertices,
            constraints,
            |edge| conflicts.push(edge),
        )
        .map_err(|error| format!("Could not normalize terrain interfaces: {error:?}"))?;
    let boundary_handles = boundary_triangulation
        .vertices()
        .map(|vertex| vertex.fix())
        .collect::<Vec<_>>();
    for [from, to] in conflicts {
        boundary_triangulation.add_constraint_and_split(
            boundary_handles[from],
            boundary_handles[to],
            |position| Vertex {
                p: position,
                z: l.z(g, [position.x, position.y]),
            },
        );
    }

    let mut vertices = boundary_triangulation
        .vertices()
        .map(|vertex| *vertex.data())
        .collect::<Vec<_>>();
    let constraints = boundary_triangulation
        .undirected_edges()
        .filter(|edge| edge.is_constraint_edge())
        .map(|edge| {
            let [from, to] = edge.vertices();
            [from.fix().index(), to.fix().index()]
        })
        .collect::<Vec<_>>();
    let mut vertex_map = vertices
        .iter()
        .enumerate()
        .map(|(index, vertex)| {
            (
                (
                    (vertex.p.x * 1e7).round() as i64,
                    (vertex.p.y * 1e7).round() as i64,
                ),
                index,
            )
        })
        .collect::<HashMap<_, _>>();

    for point in base
        .mesh
        .positions
        .chunks_exact(3)
        .take(base.retained_samples)
        .map(|point| [point[0], point[1]])
    {
        let position = spade::Point2::new(point[0], point[1]);
        let on_interface = match boundary_triangulation.locate(position) {
            spade::PositionInTriangulation::OnVertex(_) => true,
            spade::PositionInTriangulation::OnEdge(edge) => boundary_triangulation
                .directed_edge(edge)
                .is_constraint_edge(),
            _ => false,
        };
        if boundary.contains(&Point::new(point[0], point[1])) && !on_interface {
            add_point(point, &mut vertices, &mut vertex_map);
        }
    }
    let triangulation =
        spade::ConstrainedDelaunayTriangulation::<Vertex>::bulk_load_cdt(vertices, constraints)
            .map_err(|error| format!("Could not triangulate feature-aware terrain: {error:?}"))?;
    let points: Vec<[f64; 2]> = triangulation
        .vertices()
        .map(|vertex| [vertex.position().x, vertex.position().y])
        .collect();
    let mut faces: Vec<([u32; 3], usize)> = vec![];
    for face in triangulation.inner_faces() {
        let vertices = face.vertices();
        let mut triangle = [
            vertices[0].fix().index() as u32,
            vertices[1].fix().index() as u32,
            vertices[2].fix().index() as u32,
        ];
        let center = Point::new(
            (points[triangle[0] as usize][0]
                + points[triangle[1] as usize][0]
                + points[triangle[2] as usize][0])
                / 3.,
            (points[triangle[0] as usize][1]
                + points[triangle[1] as usize][1]
                + points[triangle[2] as usize][1])
                / 3.,
        );
        if !boundary.contains(&center) {
            continue;
        }
        let region = pockets
            .iter()
            .position(|pocket| pocket.polygon.contains(&center))
            .map_or(0, |index| index + 1);
        let a = points[triangle[0] as usize];
        let b = points[triangle[1] as usize];
        let c = points[triangle[2] as usize];
        if (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0. {
            triangle.swap(1, 2);
        }
        faces.push((triangle, region));
    }
    if faces.is_empty() {
        return Err("Feature-aware terrain contains no surface faces".into());
    }

    let surface_height = |region: usize, vertex: u32| {
        if region == 0 {
            l.z(g, points[vertex as usize])
        } else {
            pockets[region - 1].height_mm
        }
    };
    let surface_key = |region: usize, vertex: u32| {
        (
            vertex,
            (surface_height(region, vertex) * 1e7).round() as i64,
        )
    };
    let mut mesh = Mesh::default();
    let mut top_indices: HashMap<(u32, i64), u32> = HashMap::new();
    let mut base_indices = vec![None; points.len()];
    for (triangle, region) in &faces {
        for &vertex in triangle {
            let z = surface_height(*region, vertex);
            top_indices
                .entry(surface_key(*region, vertex))
                .or_insert_with(|| {
                    let point = points[vertex as usize];
                    let index = mesh.positions.len() as u32 / 3;
                    mesh.positions.extend([point[0], point[1], z]);
                    index
                });
            if base_indices[vertex as usize].is_none() {
                let point = points[vertex as usize];
                let index = mesh.positions.len() as u32 / 3;
                mesh.positions.extend([point[0], point[1], 0.]);
                base_indices[vertex as usize] = Some(index);
            }
        }
    }

    type RegionEdge = (usize, [u32; 2]);
    let mut adjacency: HashMap<(u32, u32), Vec<RegionEdge>> = HashMap::new();
    let mut vertex_regions = vec![HashSet::new(); points.len()];
    for (triangle, region) in &faces {
        for vertex in triangle {
            vertex_regions[*vertex as usize].insert(*region);
        }
        mesh.indices.extend([
            top_indices[&surface_key(*region, triangle[0])],
            top_indices[&surface_key(*region, triangle[1])],
            top_indices[&surface_key(*region, triangle[2])],
        ]);
        mesh.indices.extend([
            base_indices[triangle[2] as usize].unwrap(),
            base_indices[triangle[1] as usize].unwrap(),
            base_indices[triangle[0] as usize].unwrap(),
        ]);
        for edge in [
            [triangle[0], triangle[1]],
            [triangle[1], triangle[2]],
            [triangle[2], triangle[0]],
        ] {
            adjacency
                .entry((edge[0].min(edge[1]), edge[0].max(edge[1])))
                .or_default()
                .push((*region, edge));
        }
    }

    let height = surface_height;
    let mut wall_indices = top_indices.clone();
    for neighbors in adjacency.values() {
        match neighbors.as_slice() {
            [(region, [a, b])] => {
                let top_a = top_indices[&surface_key(*region, *a)];
                let top_b = top_indices[&surface_key(*region, *b)];
                let base_a = base_indices[*a as usize].unwrap();
                let base_b = base_indices[*b as usize].unwrap();
                mesh.indices
                    .extend([top_a, base_b, top_b, top_a, base_a, base_b]);
            }
            [(left_region, left_edge), (right_region, right_edge)]
                if left_region != right_region =>
            {
                let left_height =
                    (height(*left_region, left_edge[0]) + height(*left_region, left_edge[1])) / 2.;
                let right_height = (height(*right_region, right_edge[0])
                    + height(*right_region, right_edge[1]))
                    / 2.;
                let (high_region, high_edge, low_region) = if left_height >= right_height {
                    (*left_region, *left_edge, *right_region)
                } else {
                    (*right_region, *right_edge, *left_region)
                };
                let [a, b] = high_edge;
                let high_a = height(high_region, a);
                let high_b = height(high_region, b);
                let low_a = height(low_region, a);
                let low_b = height(low_region, b);
                let levels = |vertex: u32, start: f64, end: f64| {
                    let minimum = start.min(end);
                    let maximum = start.max(end);
                    let mut levels = vertex_regions[vertex as usize]
                        .iter()
                        .map(|region| height(*region, vertex))
                        .filter(|value| *value >= minimum - 1e-9 && *value <= maximum + 1e-9)
                        .collect::<Vec<_>>();
                    levels.extend([start, end]);
                    levels.sort_by(f64::total_cmp);
                    levels.dedup_by(|left, right| (*left - *right).abs() < 1e-9);
                    if start > end {
                        levels.reverse();
                    }
                    levels
                };
                let mut chain = |vertex: u32, start: f64, end: f64| {
                    levels(vertex, start, end)
                        .into_iter()
                        .map(|z| {
                            let key = (vertex, (z * 1e7).round() as i64);
                            *wall_indices.entry(key).or_insert_with(|| {
                                let point = points[vertex as usize];
                                let index = mesh.positions.len() as u32 / 3;
                                mesh.positions.extend([point[0], point[1], z]);
                                index
                            })
                        })
                        .collect::<Vec<_>>()
                };
                let a_chain = chain(a, high_a, low_a);
                let b_chain = chain(b, high_b, low_b);
                let mut a_index = 0;
                let mut b_index = 0;
                while a_index + 1 < a_chain.len() || b_index + 1 < b_chain.len() {
                    let a_progress = if a_index + 1 < a_chain.len() {
                        (a_index + 1) as f64 / (a_chain.len() - 1) as f64
                    } else {
                        f64::INFINITY
                    };
                    let b_progress = if b_index + 1 < b_chain.len() {
                        (b_index + 1) as f64 / (b_chain.len() - 1) as f64
                    } else {
                        f64::INFINITY
                    };
                    if a_progress <= b_progress {
                        let triangle = [a_chain[a_index], a_chain[a_index + 1], b_chain[b_index]];
                        if triangle[0] != triangle[1]
                            && triangle[1] != triangle[2]
                            && triangle[2] != triangle[0]
                        {
                            mesh.indices.extend(triangle);
                        }
                        a_index += 1;
                    } else {
                        let triangle = [a_chain[a_index], b_chain[b_index + 1], b_chain[b_index]];
                        if triangle[0] != triangle[1]
                            && triangle[1] != triangle[2]
                            && triangle[2] != triangle[0]
                        {
                            mesh.indices.extend(triangle);
                        }
                        b_index += 1;
                    }
                }
            }
            [_, _] => {}
            _ => return Err("Feature-aware terrain has a non-manifold surface edge".into()),
        }
    }
    mesh.validate()?;
    Ok(mesh)
}

struct InsertLayerContext<'a> {
    grid: &'a Grid,
    settings: &'a Settings,
    layout: &'a Layout,
    class: &'a str,
    segment_size_mm: [f64; 2],
    roof_mm: f64,
}

fn add_insert_layer(
    out: &mut Plan,
    context: &InsertLayerContext<'_>,
    layer: &MultiPolygon<f64>,
    feature: Option<&Feature>,
    depth: f64,
    pocket_surfaces: &mut Vec<PocketSurface>,
    serial: &mut usize,
) -> Result<(), String> {
    let g = context.grid;
    let s = context.settings;
    let l = context.layout;
    let class = context.class;
    let seg = context.segment_size_mm;
    let roof = context.roof_mm;
    let zone = feature.is_some_and(Feature::is_zone);
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
            let raw_pockets = layer.intersection(&MultiPolygon(vec![cell.clone()]));
            let gap = s.effective_insert_gap_mm();
            let part_cell = if gap == 0. {
                MultiPolygon(vec![cell.clone()])
            } else {
                cell.buffer(-gap / 2.)
            };
            let raw_parts = layer.intersection(&part_cell);
            let parts = printable_parts(raw_parts, s.nozzle_diameter_mm);
            if parts.0.is_empty() {
                continue;
            }
            // Print-together pockets use the exact post-repair insert boundary. This keeps
            // canonical interface coordinates even when polygon cleanup changes a narrow feature.
            let pockets = if s.manufacturing_mode == ManufacturingMode::Multicolor {
                parts.clone()
            } else {
                raw_pockets
            };
            let surface = |q| fixed_level.unwrap_or_else(|| l.z(g, q));
            let requested_offset = s.insert_surface_offset_mm();
            let minimum_surface_mm = pockets
                .0
                .iter()
                .map(|pocket| minimum_insert_surface(pocket, g, l, fixed_level))
                .fold(f64::INFINITY, f64::min);
            if !minimum_surface_mm.is_finite() {
                continue;
            }
            let surface_offset_mm =
                effective_insert_surface_offset(minimum_surface_mm, requested_offset, floor);
            let top = |q| surface(q) + surface_offset_mm;
            let base = (minimum_surface_mm + surface_offset_mm - depth)
                .max(floor + INSERT_SUBSTRATE_CLEARANCE_MM);
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
                    insert_depth_mm: depth,
                    surface_offset_mm,
                    conformal,
                });
            }
            for raw_pocket in pockets.buffer(s.effective_insert_clearance_mm()).0 {
                let (pocket, removed) = remove_unprintable_terrain_islands(
                    &raw_pocket,
                    s.effective_minimum_terrain_island_width_mm(),
                );
                out.removed_terrain_islands += removed;
                pocket_surfaces.push(PocketSurface {
                    polygon: pocket,
                    height_mm: s.insert_pocket_bottom_mm(base, floor),
                });
            }
        }
    }
    Ok(())
}
/// Build insert pieces and grouped cutter meshes for final solid generation.
pub fn plan(g: &Grid, s: &Settings, features: &[Feature], l: &Layout) -> Result<Plan, String> {
    s.validate()?;
    let base_terrain = terrain(g, s)?;
    let clip = feature_boundary(s, l, 0.);
    let insert_clip = feature_boundary(s, l, s.effective_insert_clearance_mm());
    let mut occupied = MultiPolygon(vec![]);
    let mut occupied_inserts = MultiPolygon(vec![]);
    let mut out = Plan {
        terrain: Mesh::default(),
        inserts: vec![],
        cutters: vec![],
        cutter_group_ends: vec![],
        removed_terrain_islands: 0,
    };
    let seg = if s.manufacturing_mode == ManufacturingMode::Multicolor {
        s.max_print_size_mm
    } else {
        s.insert_segment_size_mm
            .map(|value| [value, value])
            .unwrap_or(s.max_print_size_mm)
    };
    let mut pocket_surfaces = vec![];
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
        let cutter_group_start = out.cutters.len();
        let occupied_before = occupied.clone();
        let mut union = MultiPolygon(vec![]);
        let insert_features: Vec<_> = features
            .iter()
            .filter(|f| f.treatment() == Treatment::Insert && f.class == class)
            .collect();
        for f in &insert_features {
            union = union.union(&feature_polygon(f, l, s, 0.));
        }
        let layer = union.intersection(&insert_clip).difference(&occupied);
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
        let insert_context = InsertLayerContext {
            grid: g,
            settings: s,
            layout: l,
            class,
            segment_size_mm: seg,
            roof_mm: roof,
        };
        if zone_class(class) {
            let mut claimed = MultiPolygon(vec![]);
            let mut terrain_groups: Vec<(f64, &Feature, MultiPolygon<f64>)> = vec![];
            for f in insert_features {
                let individual = feature_polygon(f, l, s, 0.)
                    .intersection(&insert_clip)
                    .difference(&occupied_before)
                    .intersection(&layer)
                    .difference(&claimed);
                let depth = f.insert_depth_mm.unwrap_or(s.zone_insert_depth_mm);
                if f.surface == ZoneSurface::Level {
                    add_insert_layer(
                        &mut out,
                        &insert_context,
                        &individual,
                        Some(f),
                        depth,
                        &mut pocket_surfaces,
                        &mut serial,
                    )?;
                } else if let Some((_, _, group)) = terrain_groups
                    .iter_mut()
                    .find(|(group_depth, _, _)| (*group_depth - depth).abs() < 1e-9)
                {
                    *group = group.union(&individual);
                } else {
                    terrain_groups.push((depth, f, individual.clone()));
                }
                claimed = claimed.union(&individual);
            }
            for (depth, feature, group) in terrain_groups {
                add_insert_layer(
                    &mut out,
                    &insert_context,
                    &group,
                    Some(feature),
                    depth,
                    &mut pocket_surfaces,
                    &mut serial,
                )?;
            }
        } else {
            add_insert_layer(
                &mut out,
                &insert_context,
                &layer,
                None,
                s.insert_depth_mm,
                &mut pocket_surfaces,
                &mut serial,
            )?;
        }
        if out.cutters.len() > cutter_group_start {
            out.cutter_group_ends.push(out.cutters.len());
        }
        occupied = occupied.union(&layer).union(&carved);
        occupied_inserts = occupied_inserts.union(&layer);
    }
    if pocket_surfaces.is_empty() {
        out.terrain = base_terrain.mesh;
    } else {
        let direct_terrain =
            if classify_pocket_topology(&pocket_surfaces) == PocketTerrainStrategy::Direct {
                feature_aware_terrain(&base_terrain, g, s, l, &pocket_surfaces).ok()
            } else {
                None
            };
        if let Some(terrain) = direct_terrain {
            out.terrain = terrain;
        } else {
            // Multi-height regions can meet in a non-manifold vertical junction.
            // Preserve correctness with the established bounded Boolean path.
            out.terrain = base_terrain.mesh;
            for pocket in pocket_surfaces {
                let cutter =
                    polygon_surface_detail(&pocket.polygon, |_| roof, pocket.height_mm, false);
                cutter
                    .validate()
                    .map_err(|error| format!("Fallback pocket: {error}"))?;
                out.cutters.push(cutter);
            }
        }
    }
    Ok(out)
}
/// Construct public Copernicus GLO-30 or GLO-90 tile URLs for geographic bounds.
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
/// Build the Overpass query for supported features within geographic bounds.
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
    fn preview_ribbon_follows_surface_with_configured_offset() {
        let mesh = preview_ribbon(&rectangle(4., 3.), |p| 2. + p[0] * 0.7 + p[1] * 0.2, 0.35);
        let half = mesh.positions.len() / 2;
        for (i, p) in mesh.positions.chunks_exact(3).enumerate() {
            let surface = 2. + p[0] * 0.7 + p[1] * 0.2;
            let expected = surface + if i * 3 < half { 0.35 } else { 0. };
            assert!((p[2] - expected).abs() < 1e-9);
        }
        mesh.validate().unwrap();
    }
    #[test]
    fn inset_surface_is_clamped_to_preserve_substrate_and_insert_thickness() {
        assert_eq!(effective_insert_surface_offset(1., -0.3, 0.8), 0.);
        assert_eq!(effective_insert_surface_offset(2., -0.3, 0.8), -0.3);
    }

    #[test]
    fn insert_surface_modes_place_watertight_parts_in_both_manufacturing_modes() {
        let flat = Grid {
            bounds: [0., 0., 0.001, 0.001],
            width: 9,
            height: 9,
            elevations: vec![100.; 81],
        };
        let feature = Feature {
            id: "path".into(),
            name: "Path".into(),
            class: "trail".into(),
            lines: vec![vec![[0.0002, 0.0005], [0.0008, 0.0005]]],
            polygons: vec![],
            enabled: true,
            treatment: Treatment::Insert,
            surface: ZoneSurface::Terrain,
            width_m: None,
            insert_depth_mm: None,
            tags: Value::Null,
        };
        for manufacturing_mode in [ManufacturingMode::Separate, ManufacturingMode::Multicolor] {
            for (insert_surface_mode, expected_top) in [
                (InsertSurfaceMode::Proud, 1.35),
                (InsertSurfaceMode::Flush, 1.),
                (InsertSurfaceMode::Inset, 0.7),
            ] {
                let settings = Settings {
                    manufacturing_mode,
                    insert_surface_mode,
                    max_print_size_mm: [10., 10.],
                    ..Default::default()
                };
                let terrain = terrain(&flat, &settings).unwrap();
                let plan = plan(
                    &flat,
                    &settings,
                    std::slice::from_ref(&feature),
                    &terrain.layout,
                )
                .unwrap();
                plan.terrain.validate().unwrap();
                assert!(!plan.inserts.is_empty());
                for piece in &plan.inserts {
                    piece.mesh.validate().unwrap();
                    let top = piece
                        .mesh
                        .positions
                        .chunks_exact(3)
                        .map(|point| point[2] + piece.origin[2])
                        .fold(f64::NEG_INFINITY, f64::max);
                    assert!((top - expected_top).abs() < 1e-6);
                    assert!(
                        (piece.surface_offset_mm - settings.insert_surface_offset_mm()).abs()
                            < 1e-9
                    );
                }
            }
        }
    }

    #[test]
    fn legacy_settings_default_to_proud_surface_placement() {
        let settings: Settings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(settings.insert_surface_mode, InsertSurfaceMode::Proud);
        assert_eq!(settings.insert_proud_height_mm, 0.35);
        assert_eq!(settings.insert_inset_depth_mm, 0.3);
        assert_eq!(settings.insert_surface_offset_mm(), 0.35);
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
    fn tiled_full_resolution_stitches_shared_vertices() {
        let grid = Grid {
            bounds: [0., 0., 0.26, 0.002],
            width: 261,
            height: 3,
            elevations: vec![100.; 261 * 3],
        };
        let terrain = terrain(&grid, &Settings::default()).unwrap();
        terrain.mesh.validate().unwrap();
        let top_vertices = terrain.retained_samples as u32;
        let seam = (128_u32, 128_u32 + grid.width as u32);
        let mut uses = 0;
        for triangle in terrain.mesh.indices.chunks_exact(3) {
            if triangle.iter().all(|index| *index < top_vertices) {
                for (a, b) in [
                    (triangle[0], triangle[1]),
                    (triangle[1], triangle[2]),
                    (triangle[2], triangle[0]),
                ] {
                    if (a.min(b), a.max(b)) == seam {
                        uses += 1;
                    }
                }
            }
        }
        assert_eq!(uses, 2);
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
    fn terrain_island_width_defaults_to_three_extrusions() {
        let settings = Settings::default();
        assert!((settings.effective_minimum_terrain_island_width_mm() - 1.35).abs() < 1e-9);
        let disabled = Settings {
            minimum_terrain_island_width_mm: Some(0.),
            ..settings
        };
        assert_eq!(disabled.effective_minimum_terrain_island_width_mm(), 0.);
    }
    #[test]
    fn removes_only_unprintable_enclosed_terrain_islands() {
        let outer = rectangle(10., 10.);
        let small = polygon(&[[4.7, 4.7], [5.3, 4.7], [5.3, 5.3], [4.7, 5.3]]);
        let large = polygon(&[[1., 1.], [3., 1.], [3., 3.], [1., 3.]]);
        let pocket = Polygon::new(
            outer.exterior().clone(),
            vec![small.exterior().clone(), large.exterior().clone()],
        );
        let (cleaned, removed) = remove_unprintable_terrain_islands(&pocket, 1.35);
        assert_eq!(removed, 1);
        assert_eq!(cleaned.interiors().len(), 1);
        assert_eq!(cleaned.interiors()[0], *large.exterior());
    }
    #[test]
    fn leaves_open_terrain_channels_unchanged() {
        let open_notch = polygon(&[
            [0., 0.],
            [10., 0.],
            [10., 10.],
            [6., 10.],
            [6., 2.],
            [4., 2.],
            [4., 10.],
            [0., 10.],
        ]);
        let (cleaned, removed) = remove_unprintable_terrain_islands(&open_notch, 3.);
        assert_eq!(removed, 0);
        assert_eq!(cleaned, open_notch);
    }
    #[test]
    fn multicolor_uses_canonical_zero_clearance_interface() {
        let separate = Settings::default();
        assert_eq!(separate.effective_insert_clearance_mm(), 0.15);
        assert_eq!(separate.insert_pocket_bottom_mm(2., 0.8), 1.85);
        let together = Settings {
            manufacturing_mode: ManufacturingMode::Multicolor,
            ..separate
        };
        assert_eq!(together.effective_insert_clearance_mm(), 0.);
        assert_eq!(together.effective_insert_gap_mm(), 0.);
        assert_eq!(together.insert_pocket_bottom_mm(2., 0.8), 2.);
    }
    #[test]
    fn multicolor_keeps_structural_zone_floor() {
        let settings = Settings {
            manufacturing_mode: ManufacturingMode::Multicolor,
            zone_floor_mm: 1.2,
            ..Default::default()
        };
        let requested_base: f64 = 0.5;
        let base = requested_base.max(settings.zone_floor_mm + 0.15);
        assert!(base > settings.zone_floor_mm);
        assert_eq!(
            settings.insert_pocket_bottom_mm(base, settings.zone_floor_mm),
            base
        );
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
