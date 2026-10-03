use contour_core::*;
fn fixture() -> (Grid, Settings, Feature) {
    let g = Grid {
        bounds: [0., 0., 0.001, 0.001],
        width: 11,
        height: 11,
        elevations: vec![100.; 121],
    };
    let s = Settings {
        max_print_size_mm: [10., 10.],
        path_width_mm: 1.,
        carve_depth_mm: 0.4,
        ..Default::default()
    };
    let f = Feature {
        id: "test".into(),
        name: "Test".into(),
        class: "trail".into(),
        lines: vec![vec![[0.00025, 0.0005], [0.00075, 0.0005]]],
        polygons: vec![],
        enabled: true,
        treatment: Treatment::VCarve,
        surface: ZoneSurface::Terrain,
        width_m: None,
        insert_depth_mm: None,
        tags: serde_json::Value::Null,
    };
    (g, s, f)
}
#[test]
fn v_profile_has_low_center_and_surface_edges() {
    let (g, s, f) = fixture();
    let t = terrain(&g, &s).unwrap();
    let p = plan(&g, &s, &[f], &t.layout).unwrap();
    assert!(p.inserts.is_empty());
    assert!(!p.cutters.is_empty());
    let mut center = false;
    let mut edge = false;
    for cut in p.cutters {
        cut.validate().unwrap();
        for p in cut.positions.chunks_exact(3) {
            if p[2] < 2. {
                if (p[1] - 5.).abs() < 1e-6 && p[0] > 3. && p[0] < 7. {
                    assert!((p[2] - 0.6).abs() < 1e-5);
                    center = true;
                }
                if (p[1] - 4.5).abs() < 0.002 {
                    assert!((p[2] - 1.).abs() < 0.002);
                    edge = true;
                }
            }
        }
    }
    assert!(center && edge);
}
#[test]
fn hidden_features_create_no_geometry() {
    let (g, s, mut f) = fixture();
    f.treatment = Treatment::Hide;
    let t = terrain(&g, &s).unwrap();
    let p = plan(&g, &s, &[f.clone()], &t.layout).unwrap();
    assert!(p.inserts.is_empty() && p.cutters.is_empty());
    assert!(overlays(&g, &s, &[f], &t.layout).unwrap().is_empty());
}
#[test]
fn inserts_win_over_same_class_carves() {
    let (g, s, f) = fixture();
    let mut insert = f.clone();
    insert.id = "insert".into();
    insert.treatment = Treatment::Insert;
    let t = terrain(&g, &s).unwrap();
    let only = plan(&g, &s, &[insert.clone()], &t.layout).unwrap();
    let both = plan(&g, &s, &[insert, f], &t.layout).unwrap();
    assert_eq!(only.cutters.len(), both.cutters.len());
    assert_eq!(only.inserts.len(), both.inserts.len());
}
#[test]
fn deep_carves_preserve_floor() {
    let (g, mut s, f) = fixture();
    s.carve_depth_mm = 4.;
    let t = terrain(&g, &s).unwrap();
    let p = plan(&g, &s, &[f], &t.layout).unwrap();
    assert!(p
        .cutters
        .iter()
        .all(|m| m.positions.chunks_exact(3).all(|v| v[2] >= 0.4)));
}
#[test]
fn legacy_projects_default_to_insert() {
    let f: Feature = serde_json::from_value(
        serde_json::json!({"id":"old","name":"Old","class":"trail","lines":[],"enabled":true}),
    )
    .unwrap();
    assert_eq!(f.treatment(), Treatment::Insert);
}
#[test]
fn crossing_carve_overlaps_pocket_clearance_without_cutting_insert() {
    let (g, s, carve) = fixture();
    let mut insert = carve.clone();
    insert.id = "crossing-insert".into();
    insert.treatment = Treatment::Insert;
    insert.lines = vec![vec![[0.0005, 0.00025], [0.0005, 0.00075]]];
    let t = terrain(&g, &s).unwrap();
    let p = plan(&g, &s, &[insert, carve], &t.layout).unwrap();
    assert!(!p.inserts.is_empty());
    // Groove cutters precede the insert pocket. Their inner endpoints overlap
    // the pocket's 0.05 mm clearance by 0.002 mm, outside the 0.5 mm insert half-width.
    let left = p.cutters[0]
        .positions
        .chunks_exact(3)
        .map(|p| p[0])
        .fold(f64::NEG_INFINITY, f64::max);
    let right = p.cutters[0]
        .positions
        .chunks_exact(3)
        .map(|p| p[0])
        .fold(f64::INFINITY, f64::min);
    assert!((left - 4.452).abs() < 0.001 || (right - 5.548).abs() < 0.001);
    for m in p.cutters {
        m.validate().unwrap();
    }
}

fn x_bounds(mesh: &Mesh, offset: f64) -> [f64; 2] {
    mesh.positions
        .chunks_exact(3)
        .fold([f64::INFINITY, f64::NEG_INFINITY], |bounds, point| {
            [
                bounds[0].min(point[0] + offset),
                bounds[1].max(point[0] + offset),
            ]
        })
}

#[test]
fn crossing_paths_and_pockets_leave_the_configured_edge_margin() {
    let (g, mut s, mut feature) = fixture();
    s.feature_edge_clearance_mm = 1.;
    feature.lines = vec![vec![[0., 0.0005], [0.001, 0.0005]]];
    feature.treatment = Treatment::Insert;
    let terrain = terrain(&g, &s).unwrap();
    let insert_plan = plan(&g, &s, &[feature.clone()], &terrain.layout).unwrap();
    assert!(!insert_plan.inserts.is_empty());
    let insert_margin = s.feature_edge_clearance_mm + s.insert_fit_clearance_per_side_mm;
    for piece in &insert_plan.inserts {
        let bounds = x_bounds(&piece.mesh, piece.origin[0]);
        assert!(bounds[0] >= insert_margin - 0.01);
        assert!(bounds[1] <= terrain.layout.width - insert_margin + 0.01);
    }
    for pocket in &insert_plan.cutters {
        let bounds = x_bounds(pocket, 0.);
        assert!(bounds[0] >= s.feature_edge_clearance_mm - 0.01);
        assert!(bounds[1] <= terrain.layout.width - s.feature_edge_clearance_mm + 0.01);
    }
    for overlay in overlays(&g, &s, &[feature.clone()], &terrain.layout).unwrap() {
        let bounds = x_bounds(&overlay.mesh, 0.);
        assert!(bounds[0] >= insert_margin - 0.01);
        assert!(bounds[1] <= terrain.layout.width - insert_margin + 0.01);
    }

    feature.treatment = Treatment::VCarve;
    let carve_plan = plan(&g, &s, &[feature.clone()], &terrain.layout).unwrap();
    assert!(!carve_plan.cutters.is_empty());
    for cutter in &carve_plan.cutters {
        let bounds = x_bounds(cutter, 0.);
        assert!(bounds[0] >= s.feature_edge_clearance_mm - 0.01);
        assert!(bounds[1] <= terrain.layout.width - s.feature_edge_clearance_mm + 0.01);
    }
    for overlay in overlays(&g, &s, &[feature], &terrain.layout).unwrap() {
        let bounds = x_bounds(&overlay.mesh, 0.);
        assert!(bounds[0] >= s.feature_edge_clearance_mm - 0.01);
        assert!(bounds[1] <= terrain.layout.width - s.feature_edge_clearance_mm + 0.01);
    }
}
