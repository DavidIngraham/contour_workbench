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

## Design and export

The bundled Post Canyon example opens automatically with 246,078 elevation samples and the original five-vertex Post Canyon boundary rounded with a default 500 m corner radius. Choose an area on the slippy map: draw a freeform or smooth spline polygon, or select Square, Rectangle, or Circle. Presets have dimensions in meters, a draggable center, and edge handles for resizing. Click the nearby rotation arrow for 15° steps, or drag it for any angle. Spline control points remain editable. Rotate outlines clockwise and round freeform or preset corners with a corner radius in meters (locally limited by short edges). Circle size uses diameter. Shape controls are retained in saved projects. For freeform drawing, click Draw / redraw, place vertices, then Finish polygon. Drag vertices to edit, or undo the last point. Use loaded elevation to crop the current landscape without downloading again, or load new elevation for the outline. Concave simple polygons are supported; self-crossing outlines and holes are rejected. The exact outline clips terrain, overlays, and printable parts and is saved with the project. Load elevation, and pull trails, roads, waterways, lakes, reservoirs, rivers, and glaciers directly from OpenStreetMap. Local geographic GeoTIFF and GeoJSON imports are also supported. The Rust classifier follows the original project classification rules, including named local trails and closed/future exclusions.

When a new area starts loading, the viewport first shows the regional topo map and selected polygon. Terrain replaces that flat footprint as soon as elevation meshing finishes and the editing controls become available; OpenStreetMap trails and zones continue loading in the background and are draped afterward. The status reports each bounded mirror attempt. If every mirror fails, the terrain remains usable and the Features panel offers **Retry trails and water**. Starting another area or project cancels the old feature request. Preset packs perform the same terrain-then-features reveal using their prebuilt meshes.

Full source resolution is the default. Adaptive detail is opt-in and constrains sampled vertical error in model millimeters. Polygon zones preserve multipolygon islands and source DEM samples across their interiors. Each feature and class has a visibility checkbox and an Insert/V-carve selector. Hide/unhide preserves the selected treatment. Treatment, visibility, manufacturing mode, and insert relative-height changes refresh overlays while reusing terrain. Class selectors apply to all members; individual overrides display a Mixed class selection. Width and V-carve depth changes rebuild overlays only. Base thickness directly shifts cached surface vertices and creates no worker jobs. Bed size, elevation exaggeration, detail, and boundary changes rebuild terrain. Insert segmentation defaults to the print bed; pockets remain continuous across optional insert divisions.

Water, glacier, and ski-run areas appear as configurable zone features. Water defaults to a level blue insert; glaciers and runs follow the terrain. Each zone can switch between Insert and Recess, level and conformal surfaces, and an individual insert depth. A shallow pocket leaves a configurable continuous terrain floor under large inserts. Zone inserts remain continuous until explicit bed segmentation is selected, and the same level is retained across segments. Wide rivers that cross the terrain boundary are clipped against a small retaining rim.

Winter mode extends the Overpass query with `piste:type=downhill` and `aerialway=*`. Mapped piste areas are used directly; centerline pistes use the configurable ground width. Ski runs and glaciers preview as white inserts, chair lifts default to dark V-carves, and ordinary trails are hidden while the preset is active. Turning winter mode off restores the prior feature choices. Snowfields are intentionally excluded because their OSM coverage and tagging are inconsistent.

Generate constructs the printable terrain and fitted inserts. Review supports exploded inserts and sectioning. Download produces a ZIP containing terrain and insert STLs in millimeters, assembly origins, settings, source attribution, validation, and the editable project. The first edit to an example creates a local project automatically. New and imported designs are saved locally as they change. The landing page lists recent projects with generated scene thumbnails and actions to open, rename, duplicate, export, or delete them. Export/Open project files remain available for portable backups and preserve elevation and feature selections without requiring the services again.

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
