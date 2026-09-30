use contour_core::*;
use serde_json::json;

fn grid() -> Grid {
    Grid {
        bounds: [0.0, 0.0, 0.001, 0.001],
        width: 21,
        height: 21,
        elevations: (0..441)
            .map(|i| 100.0 + (i % 21) as f64 * 0.1 + (i / 21) as f64 * 0.05)
            .collect(),
    }
}

#[test]
fn overpass_multipolygon_keeps_holes_and_deduplicates_members() {
    let input = json!({"elements":[
        {"type":"relation","id":99,"tags":{"type":"multipolygon","natural":"water","water":"reservoir","name":"Kingsley Reservoir"},"members":[
            {"type":"way","ref":10,"role":"outer","geometry":[{"lon":0.0002,"lat":0.0002},{"lon":0.0008,"lat":0.0002},{"lon":0.0008,"lat":0.0008}]},
            {"type":"way","ref":11,"role":"outer","geometry":[{"lon":0.0008,"lat":0.0008},{"lon":0.0002,"lat":0.0008},{"lon":0.0002,"lat":0.0002}]},
            {"type":"way","ref":12,"role":"inner","geometry":[{"lon":0.00045,"lat":0.00045},{"lon":0.00055,"lat":0.00045},{"lon":0.00055,"lat":0.00055},{"lon":0.00045,"lat":0.00055},{"lon":0.00045,"lat":0.00045}]}
        ]},
        {"type":"way","id":10,"tags":{"natural":"water"},"geometry":[{"lon":0.0002,"lat":0.0002},{"lon":0.0008,"lat":0.0002},{"lon":0.0008,"lat":0.0008}]}
    ]});
    let features = normalize(&input);
    assert_eq!(features.len(), 1);
    assert_eq!(features[0].class, "water");
    assert_eq!(features[0].name, "Kingsley Reservoir");
    assert_eq!(features[0].surface, ZoneSurface::Level);
    assert_eq!(features[0].polygons.len(), 1);
    assert_eq!(features[0].polygons[0].holes.len(), 1);
}

#[test]
fn connected_zone_is_one_supported_watertight_insert() {
    let g = grid();
    let s = Settings {
        max_print_size_mm: [240.0, 200.0],
        zone_insert_depth_mm: 0.8,
        zone_floor_mm: 0.8,
        ..Default::default()
    };
    let feature = Feature {
        id: "water".into(),
        name: "Reservoir".into(),
        class: "water".into(),
        lines: vec![],
        polygons: vec![AreaPolygon {
            outer: vec![
                [0.00015, 0.0002],
                [0.00085, 0.0002],
                [0.00085, 0.0008],
                [0.00015, 0.0008],
                [0.00015, 0.0002],
            ],
            holes: vec![vec![
                [0.00045, 0.00045],
                [0.00055, 0.00045],
                [0.00055, 0.00055],
                [0.00045, 0.00055],
                [0.00045, 0.00045],
            ]],
        }],
        enabled: true,
        treatment: Treatment::Insert,
        surface: ZoneSurface::Level,
        width_m: None,
        insert_depth_mm: None,
        tags: json!({"natural":"water"}),
    };
    let terrain = terrain(&g, &s).unwrap();
    let plan = plan(&g, &s, &[feature], &terrain.layout).unwrap();
    assert_eq!(plan.inserts.len(), 1);
    assert!(!plan.cutters.is_empty());
    assert!(plan.inserts[0].origin[2] >= s.zone_floor_mm);
    plan.inserts[0].mesh.validate().unwrap();
    let width = |positions: &[f64]| {
        let xs: Vec<_> = positions.chunks_exact(3).map(|p| p[0]).collect();
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max)
            - xs.iter().copied().fold(f64::INFINITY, f64::min)
    };
    let insert_width = width(&plan.inserts[0].mesh.positions);
    let pocket_width = width(&plan.cutters[0].positions);
    assert!(pocket_width - insert_width >= 2. * s.insert_fit_clearance_per_side_mm - 0.01);
    for cutter in plan.cutters {
        cutter.validate().unwrap();
        assert!(cutter
            .positions
            .chunks_exact(3)
            .all(|p| p[2] >= s.zone_floor_mm));
    }
}

#[test]
fn winter_query_and_centerline_piste_are_supported() {
    let regular = overpass_query([-121.8, 45.2, -121.5, 45.5], false).unwrap();
    assert!(regular.contains("natural=water"));
    assert!(!regular.contains("piste:type"));
    let winter = overpass_query([-121.8, 45.2, -121.5, 45.5], true).unwrap();
    assert!(winter.contains("piste:type"));
    assert!(winter.contains("aerialway"));

    let features = normalize(&json!({"elements":[
        {"type":"way","id":7,"tags":{"piste:type":"downhill","name":"Test Run"},"geometry":[{"lon":-121.7,"lat":45.3},{"lon":-121.69,"lat":45.31}]},
        {"type":"way","id":8,"tags":{"aerialway":"chair_lift","name":"Test Chair"},"geometry":[{"lon":-121.7,"lat":45.3},{"lon":-121.68,"lat":45.32}]}
    ]}));
    assert_eq!(features[0].class, "ski_run");
    assert!(features[0].polygons.is_empty());
    assert_eq!(features[1].class, "ski_lift");
    assert_eq!(features[1].treatment, Treatment::VCarve);
}

#[test]
fn conformal_zone_is_emitted_as_a_valid_fitting_prism() {
    let g = grid();
    let s = Settings {
        max_print_size_mm: [240.0, 200.0],
        ..Default::default()
    };
    let feature = Feature {
        id: "glacier".into(),
        name: "Glacier".into(),
        class: "glacier".into(),
        lines: vec![],
        polygons: vec![AreaPolygon {
            outer: vec![
                [0.0001, 0.0001],
                [0.0009, 0.0001],
                [0.0009, 0.0009],
                [0.0001, 0.0009],
                [0.0001, 0.0001],
            ],
            holes: vec![],
        }],
        enabled: true,
        treatment: Treatment::Insert,
        surface: ZoneSurface::Terrain,
        width_m: None,
        insert_depth_mm: None,
        tags: serde_json::Value::Null,
    };
    let terrain = terrain(&g, &s).unwrap();
    let plan = plan(&g, &s, &[feature], &terrain.layout).unwrap();
    assert_eq!(plan.inserts.len(), 1);
    let piece = &plan.inserts[0];
    assert!(piece.conformal);
    piece.mesh.validate().unwrap();
    let height = piece
        .mesh
        .positions
        .chunks_exact(3)
        .map(|p| p[2])
        .fold(0.0_f64, f64::max);
    assert!(height > s.zone_insert_depth_mm);
}
