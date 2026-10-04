use super::*;
use serde::Serialize;
use serde_json::{json, Value};

fn sorted_keys<T: Serialize>(value: &T) -> Vec<String> {
    let mut keys = serde_json::to_value(value)
        .unwrap()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    keys.sort();
    keys
}

fn expected(manifest: &Value, name: &str) -> Vec<String> {
    let mut fields = manifest["fields"][name]
        .as_array()
        .unwrap()
        .iter()
        .map(|value| value.as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    fields.sort();
    fields
}

#[test]
fn serialized_contract_matches_typescript_manifest() {
    let manifest: Value =
        serde_json::from_str(include_str!("../../../web/src/serialized-contract.json")).unwrap();
    let settings = Settings::default();
    let grid = Grid {
        bounds: [-1.0, -1.0, 1.0, 1.0],
        width: 2,
        height: 2,
        elevations: vec![0.0; 4],
    };
    let area = AreaPolygon::default();
    let feature = Feature {
        id: "feature".into(),
        name: "Feature".into(),
        class: "trail".into(),
        lines: vec![],
        polygons: vec![],
        enabled: true,
        treatment: Treatment::Insert,
        surface: ZoneSurface::Terrain,
        width_m: None,
        insert_depth_mm: None,
        tags: Value::Null,
    };
    let layout = Layout {
        bounds: grid.bounds,
        width: 1.0,
        depth: 1.0,
        scale: 1.0,
        rotated: false,
        minimum: 0.0,
        height_factor: 1.0,
        base_height: 1.0,
    };
    let mesh = Mesh::default();
    let terrain = Terrain {
        mesh: mesh.clone(),
        layout,
        source_samples: 4,
        retained_samples: 4,
    };
    let overlay = Overlay {
        treatment: Treatment::Insert,
        id: "overlay".into(),
        class: "trail".into(),
        surface_offset_mm: 0.35,
        mesh: mesh.clone(),
    };
    let piece = Piece {
        id: "piece".into(),
        class: "trail".into(),
        mesh,
        origin: [0.0; 3],
        insert_depth_mm: 1.0,
        surface_offset_mm: 0.35,
        conformal: false,
    };
    let plan = Plan {
        terrain: Mesh::default(),
        inserts: vec![],
        cutters: vec![],
        cutter_group_ends: vec![],
        removed_terrain_islands: 0,
    };

    for (name, keys) in [
        ("Settings", sorted_keys(&settings)),
        ("Grid", sorted_keys(&grid)),
        ("AreaPolygon", sorted_keys(&area)),
        ("Feature", sorted_keys(&feature)),
        ("Layout", sorted_keys(&layout)),
        ("Mesh", sorted_keys(&Mesh::default())),
        ("Terrain", sorted_keys(&terrain)),
        ("Overlay", sorted_keys(&overlay)),
        ("Piece", sorted_keys(&piece)),
        ("Plan", sorted_keys(&plan)),
    ] {
        assert_eq!(keys, expected(&manifest, name), "{name} contract drifted");
    }

    assert_eq!(
        json!([ManufacturingMode::Separate, ManufacturingMode::Multicolor]),
        manifest["enums"]["ManufacturingMode"]
    );

    assert_eq!(
        json!([Treatment::Insert, Treatment::Hide, Treatment::VCarve]),
        manifest["enums"]["Treatment"]
    );
    assert_eq!(
        json!([ZoneSurface::Terrain, ZoneSurface::Level]),
        manifest["enums"]["ZoneSurface"]
    );
}
