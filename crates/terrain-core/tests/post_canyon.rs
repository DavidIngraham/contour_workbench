use contour_core::*;

#[test]
fn county_export_preserves_active_trails_with_full_names() {
    let data: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/resources/post_canyon.geojson")).unwrap();
    let features = normalize(&data);
    assert_eq!(data["features"].as_array().unwrap().len(), 218);
    assert_eq!(features.len(), 157);
    for (id, name) in [
        (446, "Mitchell Ridge"),
        (448, "Chuck Line"),
        (457, "Shadow"),
    ] {
        let feature = features.iter().find(|f| f.tags["OBJECTID"] == id).unwrap();
        assert_eq!(feature.name, name);
        assert_eq!(feature.class, "trail");
        assert!(!feature.lines.is_empty());
    }
    assert!(features.iter().all(|f| !matches!(
        f.tags["Difficulty"].as_str(),
        Some("Closed Trail" | "Future Trail" | "Decomissioned")
    )));
}

#[test]
#[ignore = "full real-data integration"]
fn real_data_plan() {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/resources/post_canyon_example.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let g: Grid = serde_json::from_value(v["grid"].clone()).unwrap();
    let f = normalize(&v["geojson"]);
    let s = Settings::default();
    let l = Layout::new(&g, &s);
    let result = plan(&g, &s, &f, &l).unwrap();
    println!("{} pieces", result.inserts.len());
}
