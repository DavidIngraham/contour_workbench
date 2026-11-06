use contour_core::{terrain, Grid, Layout, Settings};

fn grid() -> Grid {
    Grid {
        bounds: [0., 0., 0.01, 0.01],
        width: 3,
        height: 3,
        elevations: vec![100.; 9],
    }
}

#[test]
fn arbitrary_rotation_round_trips_and_fits_a_watertight_model() {
    for angle in [-127., 0., 32.5, 90., 217.] {
        let g = grid();
        let s = Settings {
            bed_rotation_deg: Some(angle),
            max_print_size_mm: [140., 90.],
            ..Default::default()
        };
        let t = terrain(&g, &s).unwrap();
        t.mesh.validate().unwrap();
        assert!(t.layout.width <= 140. + 1e-8 && t.layout.depth <= 90. + 1e-8);
        for point in [[0., 0.], [0.004, 0.008], [0.01, 0.01]] {
            let actual = t.layout.lonlat(t.layout.xy(point));
            assert!((actual[0] - point[0]).abs() < 1e-12);
            assert!((actual[1] - point[1]).abs() < 1e-12);
        }
    }
}

#[test]
fn automatic_fit_uses_the_perimeter_and_improves_a_diagonal_square() {
    let g = grid();
    let mut s = Settings {
        max_print_size_mm: [100., 100.],
        boundary: vec![[0.005, 0.], [0.01, 0.005], [0.005, 0.01], [0., 0.005]],
        ..Default::default()
    };
    let auto = Layout::new(&g, &s);
    s.bed_rotation_deg = Some(0.);
    let direct = Layout::new(&g, &s);
    assert!(auto.scale > direct.scale * 1.4);
    assert!((auto.rotation_deg.unwrap() - 45.).abs() < 0.02);
    s.boundary = vec![[0., 0.], [0.01, 0.], [0.01, 0.01], [0., 0.01]];
    s.bed_rotation_deg = None;
    assert!(Layout::new(&g, &s).rotation_deg.unwrap().abs() < 0.02);
}
