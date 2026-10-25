# Contour Workbench

A static terrain design and printable model workbench. Rust/WASM builds terrain and feature geometry in a worker; Three.js displays the design and generated assets; Manifold WASM performs solid subtraction. No Python or application server is required at runtime.

## Run locally

Install Node.js 22+, Rust, and the matching WASM binding tool:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
bash scripts/build-web.sh
cd web
npm run dev
```

Run these commands from the repository root. The production site is `web/dist`; any static HTTP server can serve it, including a GitHub Pages repository subpath.

## Install and use offline

The production build is an installable PWA on HTTPS (or localhost). Use **Install
app** under Help → Storage and offline use when Chrome offers installation, or the browser's
install menu. On iPhone/iPad, use **Share → Add to Home Screen**. The favicon and
install icons reuse the mountain mark, with SVG, ICO, Apple touch, and maskable
PNG variants. Regenerate the raster variants with `npm run render:app-icons`
after editing `public/icon.svg` (requires Playwright Chromium).

After offline setup finishes during an online visit, local and imported projects
can be opened, edited, generated, and exported offline. New terrain, external map
tiles, source requests, and bundled example downloads require a connection.
Projects remain in the existing browser-local store; browser storage eviction can
remove offline data, so exported project files remain useful backups.

Updates download in the background and wait until all workbench windows/tabs are
closed. They never force-reload an active model. Help → Storage and offline use announces a
waiting update. The cache is scoped to this app and never clears project storage.
Development mode does not register a worker. `npm run test:pwa` tests the built
site at both `/` and `/contour_workbench/`, including installability, offline
generation/export, delayed activation, and incomplete-release recovery.

## Workbench controls

File contains project creation, opening, recent projects, and editable project export. View contains camera and display controls. Model contains area editing, generation, inspection, model export. The export dialog also offers print ordering. Tools contains calibration tests and source management. Help contains navigation, terminology, installation, offline status, and local-storage guidance. Menus support arrow keys, Home/End, and Escape; view commands report their current pressed state.

Terrain settings are grouped as Area, Model dimensions, Elevation, and Mesh detail. Maximum model size scales terrain to fit; the status bar shows the resulting footprint. Features starts with a bounded, collapsible tree and a selection-properties editor. Checkbox inclusion affects both preview and export. Bulk actions state their scope and count. Print setup separates Print method, Materials, Feature geometry, and Insert fit, with specialist geometry and fit settings collapsed under Advanced. Inspect contains generated-part controls. Editing invalidates generated geometry and explains why inspection/export are unavailable until generation completes again.

## Design and export

The bundled Post Canyon example opens automatically with 246,078 elevation samples and the original five-vertex Post Canyon boundary rounded with a default 500 m corner radius. Choose an area on the slippy map: draw a freeform or smooth spline polygon, or select Square, Rectangle, or Circle. Presets have dimensions in meters, a draggable center, and edge handles for resizing. Click the nearby rotation arrow for 15° steps, or drag it for any angle. Spline control points remain editable. Rotate outlines clockwise and round freeform or preset corners with a corner radius in meters (locally limited by short edges). Circle size uses diameter. Shape controls are retained in saved projects. For freeform drawing, click Draw boundary, place vertices, then Finish polygon. Drag vertices to edit, or undo the last point. Use loaded elevation to crop the current landscape without downloading again, or load new elevation for the outline. Concave simple polygons are supported; self-crossing outlines and holes are rejected. The exact outline clips terrain, overlays, and printable parts and is saved with the project. Load elevation, and pull trails, roads, waterways, lakes, reservoirs, rivers, and glaciers directly from OpenStreetMap. Local geographic GeoTIFF and GeoJSON imports are also supported. The Rust classifier follows the original project classification rules, including named local trails and closed/future exclusions.

When a new area starts loading, the viewport first shows the regional topo map and selected polygon. Terrain replaces that flat footprint as soon as elevation meshing finishes and the editing controls become available; OpenStreetMap trails and zones continue loading in the background and are draped afterward. The status reports each bounded mirror attempt. If every mirror fails, the terrain remains usable and Add features offers **Retry trails and water**. Starting another area or project cancels the old feature request. Preset packs perform the same terrain-then-features reveal using their prebuilt meshes.

Full source resolution is the default. Adaptive detail is opt-in and constrains sampled vertical error in model millimeters. Polygon zones preserve multipolygon islands and source DEM samples across their interiors. Each feature and group has an Include in model checkbox. Select a feature, class, or source/class group to edit its treatment in Selection properties. Multicolor mode labels insert treatments Color region. Hide/unhide preserves the selected treatment. Treatment, visibility, manufacturing mode, and insert relative-height changes refresh overlays while reusing terrain. Group properties offer all-member or search-result scope; individual overrides display a Mixed class selection. Width and V-carve depth changes rebuild overlays only. Base thickness directly shifts cached surface vertices and creates no worker jobs. Bed size, elevation exaggeration, detail, and boundary changes rebuild terrain. Insert segmentation defaults to the print bed; pockets remain continuous across optional insert divisions.

Water, glacier, and ski-run areas appear as configurable zone features. Water defaults to a level blue insert; glaciers and runs follow the terrain. Each zone can switch between Insert and Recess, level and conformal surfaces, and an individual insert depth. A shallow pocket leaves a configurable continuous terrain floor under large inserts. Zone inserts remain continuous until explicit bed segmentation is selected, and the same level is retained across segments. Wide rivers that cross the terrain boundary are clipped against a small retaining rim.

Winter mode extends the Overpass query with `piste:type=downhill` and `aerialway=*`. Mapped piste areas are used directly; centerline pistes use the configurable ground width. Ski runs and glaciers preview as white inserts, chair lifts default to dark V-carves, and ordinary trails are hidden while the preset is active. Turning winter mode off restores the prior feature choices. Snowfields are intentionally excluded because their OSM coverage and tagging are inconsistent.

Generate constructs the printable terrain and fitted inserts. Inspect contains generated-part validation, triangle counts, exploded inserts, and sectioning. Download produces a ZIP containing terrain and insert STLs in millimeters, assembly origins, settings, source attribution, validation, and the editable project. The first edit to an example creates a local project automatically. New and imported designs are saved locally as they change. The landing page lists recent projects with generated scene thumbnails and actions to open, rename, duplicate, export, or delete them. Export/Open project files remain available for portable backups and preserve elevation and feature selections without requiring the services again.

## Sources and current limits

- USGS 3DEP: the browser queries the TNM catalog for geographic 10 m or 30 m GeoTIFFs, selecting the newest listed revision per tile even when USGS stores it under a historical path. Missing coverage is an explicit error; sources are never silently mixed. Auto targets at most one million raster samples: 10 m for small US areas, 30 m for larger areas, and Copernicus 90 m for giant areas. International areas start at Copernicus 30 m. Explicit source choices override this policy; the two-million-sample hard limit remains. Missing USGS coverage still requires selecting a global source.
- Copernicus: Rust constructs public S3 tile URLs. The bucket currently does **not** send browser CORS headers, so direct browser loading fails. The UI exposes tile download links; download and import a GeoTIFF for an area within that tile. Multi-tile local import is not implemented. A future approved CORS-enabled mirror or relay would enable automatic global loading.
- OpenStreetMap: direct Overpass requests rotate across configured public mirrors with a per-attempt timeout, transient-error-only retries, jittered backoff, Retry-After support, and hard attempt/time caps. Successful responses are cached for one day and duplicate OSM element IDs are removed. Water and glacier ways plus multipolygon relations are assembled locally with inner rings preserved. Very large or unusually dense queries can still exceed every public service's resource limits; the terrain remains available and feature loading can be retried.
- Geographic WGS84/NAD83 rasters only. Model XY uses a local latitude-scaled projection; NAD83 is treated as WGS84. Intended for small landscapes, not surveying. Bounds are limited to two degrees per side, latitude ±85°, and two million samples. No antimeridian areas.
- Live rasters use a native-spacing grid aligned to the first tile and include a sample halo around the exact polygon. Misaligned tiles require interpolation. No coarse TIFF overview is selected.
- Preview overlays show effective placement and class priority. Generate constructs pocket floors and shared feature interfaces directly in Rust, then applies V-carves, annotations, and conformal insert fitting as final solid operations.
- Insert pockets use a constrained feature-aware terrain mesh with canonical shared XY boundaries; equal-height regions merge and deeper regions own overlaps. A topology failure at a pathological multi-height junction falls back to bounded pocket Boolean batches. V-carves remain bounded class-preserving Boolean batches. A memory preflight can select bounded adaptive detail before allocation, grid faces are constructed in seam-sharing tiles, and transferred plan meshes are taken from Rust ownership immediately. The final terrain remains a single indexed mesh under the two-million-sample source limit.
- Printable solids are validated before optional simplification. Coordinate welding starts at 0.0000001 mm and retries up to 0.0001 mm; if needed, bounded simplification retries up to 0.005 mm remove collapsed fragments; this may reduce redundant triangles even with full-resolution terrain selected. Validation checks coordinate-welded, closed, consistently oriented topology. It is not a printer or material guarantee. Inspect the generated asset and slicer results.
- Local projects and source-data caches use IndexedDB. Browser storage quotas and private-browsing policies still apply, so export a project file for archival backups. Address search and a complete native insert-export CLI remain future work; the native CLI currently exports terrain only.

## Verify

```sh
bash scripts/check.sh
cd web
npx playwright install chromium
npm run test:mobile
npm run test:presets
```

## GitHub Pages

In repository Settings → Pages, choose **GitHub Actions**. Every push to `main` runs formatting, lint, Rust, web, mobile, and full preset-generation checks before deploying `web/dist`. The **Contour Workbench Pages** workflow also supports manual runs.

## V-carves and view controls

V-carves produce a terrain-following V-shaped groove, with the selected path width and `carve_depth_mm` (default 0.4 mm). They produce no insert. Depth is clipped to retain a 0.4 mm floor. Final cutters use a 0.001 mm contact margin to avoid zero-thickness ridges at tangent intersections. Inserts win over V-carves within a class; intersecting carves merge. The design preview uses a visual surface mask; Generate computes the actual solid.

The ground map defaults to USGS Topo in supported US regions and OpenTopoMap elsewhere. Use the map-pin toolbar button to toggle it. This is contextual imagery beneath the model and is excluded from STL export. The N button orients the camera to geographic north, including models rotated to fit the print bed. Adaptive terrain jobs report their selected millimeter tolerance.

## Annotations

The Annotations tab adds editable text and PNG artwork (up to 2 MB). PNGs are converted locally to a monochrome mask, with threshold and invert controls and a conversion preview. Transparent pixels remain empty. PNG proportions are preserved on import. Text uses the browser sans-serif font; the saved project includes the converted mask so reopening preserves the printable artwork.

Choose Raised or Engraved and Terrain top or Attached porch. Click the placement button and then the model, or drag an existing annotation. The orange corner resizes; the blue handle rotates terrain labels. Dimensions and relief depth use millimeters. Visibility, duplicate, and delete are available in the panel. These edits reuse the terrain mesh; Generate applies solid unions and subtractions and validates the resulting export.

Porches snap to a straight boundary segment long enough for the content, with a 3 mm margin and an overlap into the model. Their top can align with the base or terrain edge; minimum thickness preserves the engraving floor. Porches extend the footprint, so allow room on the print bed. Curved-edge porches and direct side engraving are not included in this version. Artwork uses a raster approximation (128 pixels across); small text or fine logos may need larger dimensions. Terrain labels must fit entirely inside the outline. Engraving preserves a minimum 0.4 mm floor.

## Mobile usability

Phones use a full-width model with a dismissible Settings panel, larger touch targets, and a scrollable polygon dialog. Run npm run test:mobile from web for the Chromium touch-emulation suite at 320 px, 390 px, and landscape sizes. The tests cover layout overflow, settings access, feature visibility and treatment, polygon selection, annotation controls, and model generation. They also run before Pages deployment. These are emulated browser checks, not physical-device or Safari testing.

## Insert fit calibration

The Print setup panel selects separate tapered inserts or multicolor print-together geometry, a signed Relative height in millimeters, plus terrain/feature colors and extruder numbers. The default +0.35 mm preserves the historical proud insert top; zero is flush with sampled terrain, and negative values create an inset. Low surfaces clamp the effective recess only when necessary to preserve the configured terrain substrate and a positive insert thickness. Flush preview uses render-only depth and polygon bias; Inset preview opens the terrain surface and adds boundary walls. Those display treatments never modify exported geometry. Print-together uses the same interface coordinates for the terrain pocket and feature body, with no fit clearance or buried taper, while preserving the configured terrain floor under large zones. Separate mode defaults to a 0.4 mm nozzle and exposes nozzle-aware pocket clearance, elephant-foot relief, taper height, and draft angle. The worker builds the buried insert profile in layer-sized steps while preserving the visible footprint and terrain-conforming top. A numbered four-fit calibration base and its inserts can be downloaded separately before committing to a full model.

After generation, Download offers an STL parts bundle, portable 3MF, Bambu Studio 3MF, PrusaSlicer multipart 3MF, Shapeways full-color OBJ/MTL/PNG ZIP, and Shapeways single-material STL or 3MF. Bambu uses material extruder assignments and either aligned print-together parts on one plate or shelf-packed removable inserts. PrusaSlicer receives one build object with aligned child parts and compatible extruder metadata. Final encoding runs in a disposable worker and transfers compact mesh copies; completion, failure, or cancellation terminates that worker so archive and geometry buffers can be reclaimed.

## Feature sources

In **Features**, choose **Add features…**, select a **Feature source**, then load it. The same dialog is available from **Tools → Manage data sources…**. The library includes
OpenStreetMap (the existing Overpass service), Hood River County recreation
trails, US Forest Service trails, National Park Service trails, BLM public trails,
Washington State trails, and OpenSkiMap ski runs and lifts. You can load several sources into one landscape. The new-landscape wizard
also offers the saved source library and class choices; Winter landscape uses the
selected source with winter display settings.

Use **Classes to load** to choose which types to import from each source. Choices
are remembered independently for each source in this browser and shared with the
new-landscape wizard. Only supported classes are offered for curated sources and
custom feeds with a fixed feature type. At least one class must be selected to load.
OpenStreetMap and OpenSkiMap requests include the class filter; other feeds are
filtered after classification. Refreshing a source updates only the chosen
classes, keeping already-loaded features in other classes and other sources.

Under **Loaded sources**, **Remove** deletes that source’s features across all
classes in the current model after confirmation, including search-hidden features.
The source stays in the library so it can be loaded again. **Remove from library**
only removes a custom source definition and keeps its loaded model features.

Open **Overlap priority** in Features and use the up/down buttons to change which
classes take precedence at overlaps. Highest priority is first; within a class,
inserts take precedence over grooves. The tree, preview, and exported geometry
follow this order in both print modes. Priority is saved with the model; **Reset
priority** restores the original order. Older models keep that original order.

The feature tree groups each class by source, then sorts sources and feature names
alphabetically. Each source group has an inclusion checkbox scoped to that source and class. Select its name to edit treatment in Selection properties (Insert or Color region, V-carve, or Recess for area features). Mixed states
reflect individual edits. Group checkboxes affect all members, including those hidden
by search. The properties editor offers explicit all-member or search-result scope; treatment changes preserve inclusion. Search also matches source names. Older OpenStreetMap and county
features are recognized from their IDs, GPX uploads use their filenames, and new
GeoJSON uploads retain their filename as the source. Unattributed features appear
under **Other features**. Class-wide and individual edits use the same properties editor.

The four national/state trail entries use official public ArcGIS services and
request only features intersecting the terrain's bounding box. Their name fields
are configured automatically. BLM uses trails managed for public use; Washington
uses RCO's current public Trails layer. Trailhead points are not imported.

| Source | Official layer | Name field |
| --- | --- | --- |
| US Forest Service | [National Forest System Trails](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0) | `trail_name` |
| National Park Service | [Public Trails](https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails/FeatureServer/0) | `TRLNAME` |
| Bureau of Land Management | [Trails Managed for Public](https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recreation/MapServer/7) | `ROUTE_PRMRY_NM` |
| Washington State | [RCO Trails Database Public View](https://services2.arcgis.com/TGEC20q86HQAeMS6/arcgis/rest/services/WA_RCO_Trails_Database_Public_View/FeatureServer/0) | `trail_name` |

OpenSkiMap uses `https://api.openskimap.org/features.geojson?bbox={bbox}&types=run,lift`
to request only the terrain area. It needs no backend or global dataset download.
The service limits each bounding box to 1,000 km²; larger terrains receive an
actionable error before downloading. The Rust importer maps active downhill,
Nordic, touring, and snow-park runs to Ski runs and active lifts to Ski lifts;
non-ski pistes and inactive features are excluded. Source metadata and attribution
are preserved in project features and export archives. Upstream source IDs keep
refresh identities stable; split features sharing upstream IDs use the API's
content ID as a suffix, so edits to those split features may reset their settings.
API implementation: https://github.com/russellporter/api.openskimap.org/blob/master/src/app.ts.
Data attribution: https://www.openskidata.org/.

Choose **Add source** to save a public HTTPS GeoJSON endpoint or ArcGIS
FeatureServer/MapServer layer URL. Give it a name and choose Automatic if it has
recognizable OSM or county tags. For untagged data, choose Trails, Roads, Streams,
Water areas, Glaciers, Ski runs, or Ski lifts. An optional name field specifies
which property contains display names. Explicit feature types apply to all
imported records; Automatic retains source-specific classification and exclusions.

Direct GeoJSON files must contain WGS84 longitude/latitude lines or polygons. A
URL may include `{bbox}`, replaced with `west,south,east,north`. ArcGIS sources
automatically query the model area and download complete batches. The endpoint
must allow browser access (CORS); authenticated services and arbitrary paginated
GeoJSON APIs are not supported. A failed or incomplete download leaves existing
features intact. Cancel source download stops a pending request.

Loading the same source again refreshes its geometry without creating duplicates.
Matching features retain their visibility and print settings; records removed
from the source disappear from that source's model snapshot. Different sources
are kept independently, so overlapping datasets can contain overlapping paths.
Stable source feature IDs preserve edits across geometry updates; anonymous
features use a content fingerprint, so editing their source geometry makes them
new features. Features outside the model's bounding box are skipped and the
terrain outline clips the printable geometry.

Use **Edit** or **Remove** to manage custom definitions. The library is saved in
this browser, while imported geometry and provenance travel with exported
projects. Removing a library entry keeps its already-imported features. Downloads
are limited to 50 MB, 20,000 features, 500,000 coordinates, and 60 seconds. Use a
smaller area or a filtered endpoint for larger datasets.

## Local projects and thumbnails

Opening an example is read-only until the first meaningful edit. At that point it receives a new project identifier and appears under Recent projects. New designs and imported project files receive identifiers when they enter the editor. Project metadata, editable state, terrain samples, and thumbnails are stored separately so ordinary control edits do not rewrite the elevation raster.

Thumbnails use the same standard camera pose as Reset view: the highest terrain point sits near the back of the model and the camera looks across it at an oblique angle. They are rendered offscreen after edits settle, so thumbnail capture does not move the live viewport. Use Export project for a portable backup because browser site data can be cleared by the user or browser.

## Landing catalog and preset packs

`public/examples/catalog.json` drives the landing cards. Each entry points to a screenshot and a compressed `.cwpack` containing the full editable project, a prebuilt terrain mesh, and prebuilt overlay meshes. Overlay IDs are validated against project feature IDs when the bundle opens, so selection and visibility remain connected to the feature tree.

To add a model, start the Vite development server, save its `.contour.json` project, then run:

```sh
node scripts/build-preset.mjs path/to/model.contour.json public/examples/presets/model.cwpack public/examples/images/model.webp
```

Add the resulting paths and card copy to `public/examples/catalog.json`. The third argument is optional and uses the same 640 × 360 offscreen renderer and standard camera pose as local-project thumbnails. After camera or presentation changes, regenerate every catalog image against a running development server with:

```sh
npm run render:preset-thumbnails
```

To apply a corner radius while preserving a preset's editable footprint, run:

```sh
node scripts/set-corner-radius.mjs input.contour.json output.contour.json 1000
```

The radius is in meters. The editable polygon remains intact and the rounded boundary is stored as the terrain extent. Arc sampling adapts to the configured print-bed scale with a 0.05 mm maximum chord error, up to the serialized boundary's vertex limit.


### Coupon thickness and taper height

**Coupon / insert thickness** sets minimum insert thickness and automatically grows
its matching coupon base. Leave the advanced **Floor thickness** at 1 mm unless
you need more solid material beneath the pockets. That floor control alone does
not change insert dimensions.

Each clearance trial repeats the same Mt. Hood Meadows terrain subset with
4 mm of relief. The switchback runs across the steeper part of every tile, and
all four inserts have identical tops that follow that terrain at zero relative
height (flush). Try each pocket with the insert facing the same direction.
The four tiles form one base; terrain can step at tile boundaries. MIN INSERT
underneath records minimum thickness; actual insert thickness varies with the
terrain. With the defaults, the base is 100 × 28 × 7 mm including its 1 mm floor.
Bambu exports keep all pieces in one file and may use multiple plates on small
printers to preserve printhead clearance around the taller parts.

Draft angle acts over a separately set **Draft taper height · maximum**, default
1.7 mm, instead of nearly the full insert depth. Extra thickness adds a straight
section above the taper; shallow inserts shorten the draft height to leave a
seating band. Elephant-foot relief retains its separate bottom taper height.
Coupon and terrain inserts use this same profile. The coupon still rejects a
requested taper that would consume too much of a narrow path, so its engraved
labels describe the actual geometry. The draft row now records both angle and
actual height; both limits are included in export metadata. Older saved projects
receive the 1.7 mm draft-height default when loaded.
