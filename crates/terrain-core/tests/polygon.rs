use contour_core::{boundary_bounds, terrain, Grid, Settings};
use geo::{Contains, LineString, Point, Polygon};
#[test]
fn concave_polygon_is_closed_and_fits_its_extent() {
    let g = Grid {
        bounds: [0., 0., 0.01, 0.01],
        width: 11,
        height: 11,
        elevations: (0..121).map(|i| (i % 11 + i / 11) as f64).collect(),
    };
    let boundary = vec![
        [0.0013, 0.0011],
        [0.0087, 0.0011],
        [0.0087, 0.0044],
        [0.0043, 0.0044],
        [0.0043, 0.0086],
        [0.0013, 0.0086],
    ];
    for tolerance in [0., 0.05] {
        let s = Settings {
            boundary: boundary.clone(),
            terrain_max_error_mm: tolerance,
            ..Default::default()
        };
        let t = terrain(&g, &s).unwrap();
        t.mesh.validate().unwrap();
        assert_eq!(t.layout.bounds, boundary_bounds(&boundary));
        let p = Polygon::new(
            LineString::from(boundary.iter().map(|p| (p[0], p[1])).collect::<Vec<_>>()),
            vec![],
        );
        for face in t.mesh.indices.chunks_exact(3) {
            let coords: Vec<_> = face
                .iter()
                .map(|i| {
                    let j = *i as usize * 3;
                    [
                        t.mesh.positions[j],
                        t.mesh.positions[j + 1],
                        t.mesh.positions[j + 2],
                    ]
                })
                .collect();
            if coords.iter().all(|p| p[2] > 0.) {
                let q = t.layout.lonlat([
                    (coords[0][0] + coords[1][0] + coords[2][0]) / 3.,
                    (coords[0][1] + coords[1][1] + coords[2][1]) / 3.,
                ]);
                assert!(p.contains(&Point::new(q[0], q[1])));
            }
        }
    }
}
#[test]
fn rejects_invalid_or_uncovered_polygons() {
    let g = Grid {
        bounds: [0., 0., 1., 1.],
        width: 2,
        height: 2,
        elevations: vec![0.; 4],
    };
    for boundary in [
        vec![[0., 0.], [1., 1.], [0., 1.], [1., 0.]],
        vec![[0., 0.], [1.1, 0.], [0., 1.]],
    ] {
        assert!(terrain(
            &g,
            &Settings {
                boundary,
                ..Default::default()
            }
        )
        .is_err());
    }
}
