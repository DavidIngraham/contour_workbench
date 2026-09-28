use super::*;
use geo::BoundingRect;
use spade::{ConstrainedDelaunayTriangulation, Point2, Triangulation};

/// Triangulate the groove footprint with constrained centerlines so its bottom
/// has an actual V cross-section, rather than a flat-bottom pocket.
pub(super) fn mesh(
    g: &Grid,
    s: &Settings,
    f: &Feature,
    l: &Layout,
    domain: &Polygon<f64>,
    roof: f64,
    clamp_floor: bool,
) -> Result<Mesh, String> {
    let mut cdt = ConstrainedDelaunayTriangulation::<Point2<f64>>::new();
    let mut constrain = |a: [f64; 2], b: [f64; 2], spacing: f64| -> Result<(), String> {
        let count = (((b[0] - a[0]).hypot(b[1] - a[1]) / spacing).ceil() as usize).max(1);
        let mut last = None;
        for i in 0..=count {
            let t = i as f64 / count as f64;
            let p = Point2::new(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
            let h = cdt
                .insert(p)
                .map_err(|e| format!("Groove triangulation: {e:?}"))?;
            if let Some(prev) = last {
                if prev != h {
                    cdt.add_constraint_and_split(prev, h, |p| p);
                }
            }
            last = Some(h);
        }
        Ok(())
    };
    let spacing = (s.path_width_mm / 2.).min(0.4).max(0.05);
    for ring in std::iter::once(domain.exterior()).chain(domain.interiors()) {
        for pair in ring.0.windows(2) {
            constrain([pair[0].x, pair[0].y], [pair[1].x, pair[1].y], spacing)?;
        }
    }
    let bounds = domain.bounding_rect().ok_or("Empty groove region")?;
    let mut segments = vec![];
    let interior = domain.buffer(-0.00001);
    for line in &f.lines {
        for pair in line.windows(2) {
            let a = l.xy(pair[0]);
            let b = l.xy(pair[1]);
            if a[0].max(b[0]) < bounds.min().x - s.path_width_mm
                || a[0].min(b[0]) > bounds.max().x + s.path_width_mm
                || a[1].max(b[1]) < bounds.min().y - s.path_width_mm
                || a[1].min(b[1]) > bounds.max().y + s.path_width_mm
            {
                continue;
            }
            if (a[0] - b[0]).hypot(a[1] - b[1]) < 1e-8 {
                continue;
            }
            segments.push((a, b));
            let line =
                geo::MultiLineString(vec![LineString::from(vec![(a[0], a[1]), (b[0], b[1])])]);
            for part in interior.clip(&line, false).0 {
                for pair in part.0.windows(2) {
                    constrain([pair[0].x, pair[0].y], [pair[1].x, pair[1].y], spacing)?;
                }
            }
        }
    }
    drop(constrain);
    let pts: Vec<_> = cdt
        .vertices()
        .map(|v| {
            let p = v.position();
            [p.x, p.y]
        })
        .collect();
    let faces: Vec<_> = cdt
        .inner_faces()
        .filter_map(|f| {
            let vs = f.vertices();
            let p = vs.map(|v| v.position());
            let mid = Point::new(
                (p[0].x + p[1].x + p[2].x) / 3.,
                (p[0].y + p[1].y + p[2].y) / 3.,
            );
            if domain.contains(&mid) {
                Some(vs.map(|v| v.index() as u32))
            } else {
                None
            }
        })
        .collect();
    let mut welded: Vec<[f64; 2]> = vec![];
    let mut bins: HashMap<(i64, i64), u32> = HashMap::new();
    let mut remap = vec![];
    for p in &pts {
        let key = ((p[0] * 1e4).round() as i64, (p[1] * 1e4).round() as i64);
        let mut found = None;
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(&id) = bins.get(&(key.0 + dx, key.1 + dy)) {
                    let q = welded[id as usize];
                    if (q[0] - p[0]).abs() < 1e-4 && (q[1] - p[1]).abs() < 1e-4 {
                        found = Some(id);
                    }
                }
            }
        }
        let id = found.unwrap_or_else(|| {
            let id = welded.len() as u32;
            welded.push(*p);
            bins.insert(key, id);
            id
        });
        remap.push(id);
    }
    let faces = faces
        .into_iter()
        .map(|f| f.map(|i| remap[i as usize]))
        .filter(|f| {
            let a = welded[f[0] as usize];
            let b = welded[f[1] as usize];
            let c = welded[f[2] as usize];
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-8
        })
        .collect();
    let pts = welded;
    let floor = |p: [f64; 2]| {
        let distance = segments
            .iter()
            .map(|(a, b)| {
                let dx = b[0] - a[0];
                let dy = b[1] - a[1];
                let t =
                    (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)).clamp(0., 1.);
                (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
            })
            .fold(f64::INFINITY, f64::min);
        let depth = s.carve_depth_mm * (1. - distance / (s.path_width_mm / 2.)).clamp(0., 1.);
        if clamp_floor {
            (l.z(g, p) - depth - 0.001 * (distance / (s.path_width_mm / 2.)).min(1.)).max(0.4)
        } else {
            l.z(g, p) - depth
        }
    };
    let mesh = solid_between(pts, faces, |_| roof, floor);
    mesh.validate()?;
    Ok(mesh)
}
pub(super) fn surface(mesh: Mesh) -> Mesh {
    let n = mesh.positions.len() / 6;
    let mut indices = vec![];
    for f in mesh.indices.chunks_exact(3) {
        if f.iter().all(|i| *i as usize >= n) {
            indices.extend([f[2] - n as u32, f[1] - n as u32, f[0] - n as u32]);
        }
    }
    Mesh {
        positions: mesh.positions[n * 3..].to_vec(),
        indices,
    }
}
