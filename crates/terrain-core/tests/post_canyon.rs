use contour_core::*;
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
