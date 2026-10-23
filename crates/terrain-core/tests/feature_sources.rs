use contour_core::*;
use serde_json::json;

#[test]
fn selected_overpass_classes_limit_request_and_keep_query_order_stable() {
    let bounds = [-121.8, 45.2, -121.5, 45.5];
    let trails = overpass_query_classes(bounds, &["trail".into()]).unwrap();
    assert!(trails.contains("path|footway"));
    assert!(trails.contains("(45.2,-121.8,45.5,-121.5)"));
    assert!(!trails.contains("residential"));
    assert!(!trails.contains("waterway"));
    assert!(!trails.contains("aerialway"));
    let ski = overpass_query_classes(bounds, &["ski_run".into(), "ski_lift".into()]).unwrap();
    assert!(ski.contains("piste:type"));
    assert!(ski.contains("aerialway"));
    assert!(!ski.contains("highway"));
    assert_eq!(
        ski,
        overpass_query_classes(
            bounds,
            &["ski_lift".into(), "ski_run".into(), "ski_run".into()]
        )
        .unwrap()
    );
    assert!(overpass_query_classes(bounds, &[]).is_err());
    assert!(overpass_query_classes(bounds, &["unsupported".into()]).is_err());
}

#[test]
fn openskimap_classifies_active_ski_uses_and_lifts_without_importing_other_pistes() {
    let properties = json!({"type":"run", "name":"Ridge", "uses":["downhill"],
        "status":"operating", "sources":[{"type":"openstreetmap","id":"way/42"}]});
    let mut input = json!({"type":"FeatureCollection","features":[{
        "type":"Feature", "properties":properties,
        "geometry":{"type":"LineString","coordinates":[[-121.6,45.6,1000],[-121.61,45.61,900]]}
    }]});
    for use_type in ["downhill", "nordic", "skitour", "snow_park"] {
        input["features"][0]["properties"]["uses"] = json!([use_type]);
        let features = normalize(&input);
        assert_eq!(features[0].class, "ski_run");
        assert_eq!(features[0].name, "Ridge");
        assert_eq!(features[0].lines[0][0], [-121.6, 45.6]);
    }
    for use_type in ["hike", "sled"] {
        input["features"][0]["properties"]["uses"] = json!([use_type]);
        assert!(normalize(&input).is_empty());
    }
    input["features"][0]["properties"]["type"] = json!("lift");
    assert_eq!(normalize(&input)[0].class, "ski_lift");
    for status in ["abandoned", "disused", "proposed", "construction"] {
        input["features"][0]["properties"]["status"] = json!(status);
        assert!(normalize(&input).is_empty());
    }
}

#[test]
fn explicit_source_mapping_imports_untagged_lines_with_custom_names() {
    let mut input = json!({"type":"FeatureCollection","features":[{
        "type":"Feature", "properties":{"LABEL":"County route", "Name":"Full name"},
        "geometry":{"type":"LineString","coordinates":[[-121.6,45.6],[-121.61,45.61]]}
    }]});
    assert!(normalize(&input).is_empty());
    input["feature_class"] = json!("trail");
    input["name_field"] = json!("LABEL");
    let features = normalize(&input);
    assert_eq!(features.len(), 1);
    assert_eq!(features[0].name, "County route");
    assert_eq!(features[0].class, "trail");
    assert_eq!(features[0].tags, input["features"][0]["properties"]);
    input["name_field"] = json!("missing");
    assert_eq!(normalize(&input)[0].name, "Full name");
    input["feature_class"] = json!("unsupported");
    assert!(normalize(&input).is_empty());
}

#[test]
fn explicit_source_mapping_keeps_polygon_holes_and_water_defaults() {
    let input = json!({"type":"FeatureCollection", "feature_class":"water", "features":[{
        "type":"Feature", "properties":{"name":"Lake"}, "geometry":{"type":"Polygon", "coordinates":[
            [[0.,0.],[1.,0.],[1.,1.],[0.,1.],[0.,0.]],
            [[0.2,0.2],[0.2,0.4],[0.4,0.4],[0.4,0.2],[0.2,0.2]]
        ]}
    }]});
    let features = normalize(&input);
    assert_eq!(features.len(), 1);
    assert_eq!(features[0].class, "water");
    assert_eq!(features[0].polygons[0].holes.len(), 1);
    assert_eq!(features[0].surface, ZoneSurface::Level);
}
