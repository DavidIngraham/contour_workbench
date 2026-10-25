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
fn class_priority_controls_preview_and_printed_overlap_in_both_manufacturing_modes() {
    let (g, mut s, mut trail) = fixture();
    trail.treatment = Treatment::Insert;
    let mut road = trail.clone();
    road.id = "road".into();
    road.class = "road".into();
    for mode in [ManufacturingMode::Separate, ManufacturingMode::Multicolor] {
        s.manufacturing_mode = mode;
        for winner in ["road", "trail"] {
            s.class_priority.retain(|class| class != winner);
            s.class_priority.insert(0, winner.into());
            let terrain = terrain(&g, &s).unwrap();
            let features = [trail.clone(), road.clone()];
            let preview = overlays(&g, &s, &features, &terrain.layout).unwrap();
            assert!(!preview.is_empty());
            assert!(preview.iter().all(|overlay| overlay.class == winner));
            let printed = plan(&g, &s, &features, &terrain.layout).unwrap();
            assert!(!printed.inserts.is_empty());
            assert!(printed.inserts.iter().all(|piece| piece.class == winner));
            printed.terrain.validate().unwrap();
            for piece in printed.inserts {
                piece.mesh.validate().unwrap();
            }
        }
    }
}

#[test]
fn class_priority_applies_to_grooves_and_disabled_classes_do_not_claim_space() {
    let (g, mut s, mut trail) = fixture();
    let mut road = trail.clone();
    road.id = "road".into();
    road.class = "road".into();
    s.class_priority.retain(|class| class != "road");
    s.class_priority.insert(0, "road".into());
    let terrain = terrain(&g, &s).unwrap();
    // Both a lower insert and a lower groove must yield to the higher groove.
    for treatment in [Treatment::Insert, Treatment::VCarve] {
        trail.treatment = treatment;
        let features = [trail.clone(), road.clone()];
        let preview = overlays(&g, &s, &features, &terrain.layout).unwrap();
        assert!(!preview.is_empty());
        assert!(preview.iter().all(|overlay| overlay.class == "road"));
        let printed = plan(&g, &s, &features, &terrain.layout).unwrap();
        assert!(printed.inserts.is_empty());
        assert_eq!(printed.cutter_group_ends.len(), 1);
        for cutter in printed.cutters {
            cutter.validate().unwrap();
        }
    }
    road.enabled = false;
    trail.treatment = Treatment::Insert;
    let features = [trail, road];
    assert!(overlays(&g, &s, &features, &terrain.layout)
        .unwrap()
        .iter()
        .all(|o| o.class == "trail"));
    assert!(!plan(&g, &s, &features, &terrain.layout)
        .unwrap()
        .inserts
        .is_empty());
}

#[test]
fn draft_height_defaults_for_old_projects_and_validates_its_own_range() {
    let old: Settings = serde_json::from_str(r#"{"insert_depth_mm":5}"#).unwrap();
    assert_eq!(old.insert_draft_height_mm, 1.7);
    let custom: Settings = serde_json::from_str(r#"{"insert_draft_height_mm":0.6}"#).unwrap();
    custom.validate().unwrap();
    let roundtrip: Settings =
        serde_json::from_value(serde_json::to_value(&custom).unwrap()).unwrap();
    assert_eq!(roundtrip.insert_draft_height_mm, 0.6);
    for height in [f64::NAN, f64::INFINITY, -0.1, 5.01] {
        let invalid = Settings {
            insert_draft_height_mm: height,
            ..Settings::default()
        };
        assert!(invalid.validate().is_err());
    }
}

#[test]
fn class_priority_migrates_old_and_partial_settings_and_validates_direct_settings() {
    let old: Settings = serde_json::from_str("{}").unwrap();
    assert_eq!(old.class_priority, Settings::default().class_priority);
    let partial: Settings = serde_json::from_value(serde_json::json!({
        "class_priority": ["road", "road", "unknown", "water"]
    }))
    .unwrap();
    assert_eq!(
        partial.class_priority,
        ["road", "water", "glacier", "ski_run", "trail", "stream", "ski_lift"]
    );
    partial.validate().unwrap();
    let roundtrip: Settings =
        serde_json::from_value(serde_json::to_value(&partial).unwrap()).unwrap();
    assert_eq!(roundtrip.class_priority, partial.class_priority);
    let mut invalid = old;
    invalid.class_priority[0] = "road".into();
    assert!(invalid.validate().unwrap_err().contains("Class priority"));
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
    assert!(only.cutters.is_empty());
    assert!(both.cutters.is_empty());
    only.terrain.validate().unwrap();
    both.terrain.validate().unwrap();
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
    assert!(insert_plan.cutters.is_empty());
    insert_plan.terrain.validate().unwrap();
    let insert_margin = s.feature_edge_clearance_mm + s.insert_fit_clearance_per_side_mm;
    for piece in &insert_plan.inserts {
        let bounds = x_bounds(&piece.mesh, piece.origin[0]);
        assert!(bounds[0] >= insert_margin - 0.01);
        assert!(bounds[1] <= terrain.layout.width - insert_margin + 0.01);
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

#[test]
fn v_carves_ignore_insert_surface_placement() {
    let (g, proud, feature) = fixture();
    let terrain = terrain(&g, &proud).unwrap();
    let proud_plan = plan(&g, &proud, std::slice::from_ref(&feature), &terrain.layout).unwrap();
    let inset = Settings {
        insert_relative_height_mm: -0.6,
        ..proud
    };
    let inset_plan = plan(&g, &inset, &[feature], &terrain.layout).unwrap();
    assert_eq!(proud_plan.cutters.len(), inset_plan.cutters.len());
    for (left, right) in proud_plan.cutters.iter().zip(&inset_plan.cutters) {
        assert_eq!(left.positions, right.positions);
        let canonical_triangles = |indices: &[u32]| {
            let mut triangles = indices
                .chunks_exact(3)
                .map(|triangle| {
                    let mut triangle = [triangle[0], triangle[1], triangle[2]];
                    triangle.sort_unstable();
                    triangle
                })
                .collect::<Vec<_>>();
            triangles.sort_unstable();
            triangles
        };
        assert_eq!(
            canonical_triangles(&left.indices),
            canonical_triangles(&right.indices)
        );
    }
}
