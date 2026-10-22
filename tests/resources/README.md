# Post Canyon trail source

`post_canyon.geojson` is the complete public Hood River County recreation-trail
export retrieved on **2026-10-22** (218 features), in WGS84 longitude/latitude.
It retains the county's original properties, feature IDs, and geometries. It
includes the county-wide published trails; the model boundary clips their display
and printable geometry to Post Canyon.

- [County recreation map](https://webmap.hoodrivercounty.gov/trail/)
- [Live map configuration](https://webmap.hoodrivercounty.gov/trail/cdn/53/config.json)
- [ArcGIS layer and query form](https://services7.arcgis.com/xtfQPw7zwSRPkcfN/ArcGIS/rest/services/Recreational_Trails_Public/FeatureServer/134)
- [Download GeoJSON](https://services7.arcgis.com/xtfQPw7zwSRPkcfN/ArcGIS/rest/services/Recreational_Trails_Public/FeatureServer/134/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&orderByFields=OBJECTID&f=geojson)

The map configuration identifies web map `8d8e2c856b734869b6fbe71faf9bf4c7`
and public feature-service item `475c284e9742431ba979bb335fa978b4`, layer **134**,
with GeoJSON export enabled. No API key is needed. The public service itself
filters out `Decomissioned`, `SxS`, `PL`, and `STMC` difficulty codes.

The query parameters are `where=1=1`, `outFields=*`, `returnGeometry=true`,
`outSR=4326`, `orderByFields=OBJECTID`, and `f=geojson`. Verify the downloaded
count against the same query with `returnCountOnly=true&f=json`. The current
layer limit is 2,000 records; if the response reaches the limit or reports
`exceededTransferLimit`, fetch successive `resultOffset` pages and check unique
OBJECTIDs and the final count before replacing the snapshot.

The 2026-10-22 snapshot contains 157 active trails, 55 closed trails, and six
future trails. Closed/future records remain in the raw export but are excluded
by the normal importer. Some active trails now have a null `Trail_Name`; their
full `Name` field supplies the display name. The old custom boundary polygon is
preserved in `post_canyon_example.json`, not mixed into the county download.

To refresh the default model, replace the county records in the example fixture
while retaining its boundary and OSM road/stream records. Normalize the downloaded
trails with the rebuilt Rust/WASM `classify_features` function and replace the
preset project's trail features, assigning IDs as `county-trail:<OBJECTID>`.
Retain the existing elevation grid, extent editor, settings, roads, and streams.
Use `web/scripts/build-preset.mjs` to regenerate the bundle and thumbnail, then
increment the Post Canyon catalog revision and update its feature badge. The
current preset contains 157 trails, 65 roads, and 298 streams (520 total).
