use contour_core::*;
use wasm_bindgen::prelude::*;
fn err(e: impl ToString) -> JsValue {
    JsValue::from_str(&e.to_string())
}
#[wasm_bindgen]
pub fn classify_features(input: &str) -> Result<String, JsValue> {
    let v = serde_json::from_str(input).map_err(err)?;
    serde_json::to_string(&normalize(&v)).map_err(err)
}
#[wasm_bindgen]
pub fn build_terrain(grid: &str, settings: &str) -> Result<String, JsValue> {
    let g = serde_json::from_str(grid).map_err(err)?;
    let s = serde_json::from_str(settings).map_err(err)?;
    serde_json::to_string(&terrain(&g, &s).map_err(err)?).map_err(err)
}
#[wasm_bindgen]
pub fn build_overlays(
    grid: &str,
    settings: &str,
    features: &str,
    layout: &str,
) -> Result<String, JsValue> {
    let g = serde_json::from_str(grid).map_err(err)?;
    let s = serde_json::from_str(settings).map_err(err)?;
    let f: Vec<Feature> = serde_json::from_str(features).map_err(err)?;
    let l = serde_json::from_str(layout).map_err(err)?;
    serde_json::to_string(&overlays(&g, &s, &f, &l).map_err(err)?).map_err(err)
}
#[wasm_bindgen]
pub fn build_plan(
    grid: &str,
    settings: &str,
    features: &str,
    layout: &str,
) -> Result<String, JsValue> {
    let g = serde_json::from_str(grid).map_err(err)?;
    let s = serde_json::from_str(settings).map_err(err)?;
    let f: Vec<Feature> = serde_json::from_str(features).map_err(err)?;
    let l = serde_json::from_str(layout).map_err(err)?;
    serde_json::to_string(&plan(&g, &s, &f, &l).map_err(err)?).map_err(err)
}
#[wasm_bindgen]
pub fn source_urls(bounds: &str, ninety: bool) -> Result<String, JsValue> {
    serde_json::to_string(
        &copernicus_urls(serde_json::from_str(bounds).map_err(err)?, ninety).map_err(err)?,
    )
    .map_err(err)
}
#[wasm_bindgen]
pub fn osm_query(bounds: &str, winter: bool) -> Result<String, JsValue> {
    overpass_query(serde_json::from_str(bounds).map_err(err)?, winter).map_err(err)
}
