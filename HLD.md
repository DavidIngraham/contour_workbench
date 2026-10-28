# Contour Workbench architecture

Status: implemented architecture, October 2026.

Fit calibration is available from the project picker, Tools, and Print setup. The dialog starts from defaults or a copy of current project settings without mutating the active project. Its main controls are thickness, nozzle diameter, path width, and four increasing per-side clearances. Advanced contains elephant-foot relief and height, draft angle and maximum taper height, and floor thickness. Validation rejects invalid or excessive-precision values and taper requests that would be clamped. All four inserts have identical terrain-conforming tops and flat bottoms.

`fit-coupon.ts` shares dimensions and engraved wording between the form and geometry worker. The default base is 88 × 20 × 7 mm, with four 22 × 20 mm terrain tiles, 4 mm of relief, a 2 mm minimum insert thickness, and a 1 mm floor. Compared with the previous 100 × 28 mm coupon, the footprint is 37% smaller. Switchback geometry, 0.45 mm minimum letter strokes, and the fit profile retain their size. Four settings rows plus a clearance row replace seven rows: nozzle/path width, minimum insert thickness, floor/terrain relief, and the clearance heading and values. Elephant-foot and draft values remain in export metadata but are not engraved. Underside text is recessed 0.4 mm, leaving at least 0.6 mm under a pocket with the default floor. Rust's lettering planner reflects Y for a long-edge flip while keeping each clearance aligned with its pocket.

A private Rust terrain session builds the bundled Mt. Hood Meadows DEM independently of the active model. The worker undoes any automatic bed-fit rotation before rescaling the terrain into each coupon tile, keeping its geographic orientation consistent as dimensions change. Four copies are unioned into one base; terrain can step at tile boundaries. Each insert is the intersection of the shared tapered switchback prism with the original terrain. Thickness adds straight material above the taper; floor thickness adds material below the pockets without changing insert dimensions. STL, standard 3MF, Bambu, and Prusa exports share these validated meshes and metadata. Bambu placement reserves the selected printer's printhead clearances and can span multiple plates.

The calibration manifest records the repeated tile dimensions and count, zero
relative height, terrain-conforming top, minimum insert thickness, and each
insert's assembly origin. STL and all 3MF variants use the same checked meshes.
Coupon relief and layout constants live in `fit-coupon.ts`, shared by geometry,
engraving, validation previews, and displayed total height. The bundled DEM and
private Rust terrain session remain the source of terrain triangulation; the
worker owns tile assembly and Manifold fitting. Export regressions ray-sample
both terrain tiles and insert tops against the independent source elevation
grid and compare the lower fit contours across overall thickness changes.

## Shared insert taper

`insert-fit.ts` owns the shared coupon and terrain fit profile. Draft now has its
own `insert_draft_height_mm` setting (default 1.7 mm, maximum 5 mm), independent of
`insert_depth_mm`. The actual draft region is the smaller of that height and the
available insert depth minus its seating band. Its inset is still derived from
the draft angle and bounded by the printable width; elephant-foot relief remains
a separate region. The worker samples only those lower taper regions at fixed
physical heights, then extends a straight section above them. Changing overall
height therefore changes neither the taper calculation nor its stepped mesh once
the configured regions fit. This applies to both real terrain pieces and coupons.

Coupon validation remains strict about width-limited insets and failed geometry;
terrain generation retains its existing defensive taper fallbacks. A height cap
shortened by a shallow insert is explicit in export metadata, which records actual
and maximum draft heights. These taper settings are not engraved on the coupon. The
additive setting is mirrored in Rust/TypeScript contracts, uses the same default
for older projects, and stays disabled/hidden with other assembly controls in
print-together mode. Older deep inserts now gain straight walls above 1.7 mm
rather than an ever-longer draft; the 2 mm default keeps its original profile.

## Purpose

Contour Workbench is a static, client-side application for designing printable terrain models. It combines elevation rasters and map features, previews the effective design in Three.js, and creates validated terrain, insert, and carved geometry without a backend.

The browser is the trust boundary for uploaded files and downloaded models. Remote services provide source data only; project editing and mesh generation stay on the user's device.

## Installable app and offline shell

`public/app.webmanifest` uses relative identity, scope, start URL, and icon URLs
for both root and GitHub Pages subpath hosting. Explicit SVG/ICO favicon links
and raster install/Apple/maskable icons derive from the existing mountain mark.
`pwa-build.ts` emits `sw.js` after production builds using a content hash of the
worker template and final cached files. The allowlist includes the HTML shell,
all bundled/lazy JS and WASM, icons, catalog, and thumbnails; large preset bundles,
external provider responses, and user project data are excluded.

The worker installs a complete version atomically, serves that version's shell
and assets from its own cache, and normally waits for old clients to close before activation.
A visible Update available — Reload action is also available in Help. Its worker
message protocol snapshots open windows in the app's scope and requests a durable
save from each. `main.ts` rejects preparation during active geometry/source work
or unfinished dialogs, flushes queued autosaves, and requires IndexedDB persistence
rather than the tab-only fallback. Prepared windows are held behind a native
progress dialog. Only after every window acknowledges saving does the waiting
worker call `skipWaiting`; `controllerchange` reloads the prepared windows. A
blocked save or a 15-second missing response cancels activation and restores the
current sessions. A 30-second client timer recovers from an interrupted protocol.
Background installation never initiates this protocol or reloads an editor. Activation only removes older
Contour Workbench shell caches in the same scope; IndexedDB/project data and
other applications' caches are untouched. `pwa.ts` offers browser-supported
installation, reports offline readiness/waiting updates, and rechecks updates
when returning after an hour. Registration is production-only. CI runs production
PWA tests for installability, offline local model generation/export, multi-window
updates, pending edits, failed durable storage, postponed operations, and failed-release recovery under both deployment path layouts.

## System context

```mermaid
flowchart LR
  User[User] --> UI[TypeScript application]
  UI --> USGS[USGS TNM catalog and GeoTIFFs]
  UI --> COP[Copernicus S3 download links]
  UI --> OSM[OpenStreetMap Overpass API]
  UI --> Features[HRC and custom GeoJSON / ArcGIS sources]
  UI --> Worker[Geometry web worker]
  Worker --> Rust[Rust terrain WASM]
  Worker --> Manifold[Manifold WASM]
  UI --> Viewer[Three.js viewer]
  Worker --> Export[STL and 3MF packages]
  Pages[GitHub Pages] --> UI
```

GitHub Pages serves HTML, JavaScript, WebAssembly, screenshots, and preset packs. There is no runtime application server.

## Components

### Rust geometry core

`crates/terrain-core` owns rules that must be deterministic and portable:

- Settings and geographic bounds validation.
- Elevation-grid sampling and geographic-to-model layout.
- OSM and GeoJSON classification and normalization.
- Full-resolution and adaptive terrain triangulation. Full-detail grid faces are emitted in 128 by 128-cell tiles that share global seam vertices; adaptive builds skip allocating the obsolete full-detail face list.
- Polygon clipping for arbitrary terrain extents.
- Preview overlays, V-carve geometry, separate insert prisms, and direct feature-aware pocket and zone-floor surfaces.
- Removal of enclosed terrain pins below the nozzle-derived printable width.
- Copernicus tile URL and Overpass query construction.
- Closed, consistently oriented mesh validation.

Geographic positions are `[longitude, latitude]` in decimal degrees. Elevations are meters at the source boundary. Generated model coordinates and print settings are millimeters unless a name explicitly ends in `_m` or `_deg`.

### WASM boundary

`crates/terrain-wasm` exposes a `TerrainSession`. The session parses, validates, and retains one elevation grid. Terrain, overlay, and plan calls send only changing settings, features, and layout data.

Geometry crosses the boundary in a versioned `CWB1` binary packet:

1. Four-byte magic value.
2. Little-endian metadata byte length and mesh count.
3. Position and index counts for every mesh.
4. UTF-8 JSON metadata.
5. Padding to a four-byte boundary.
6. Per-mesh `f32` XYZ positions followed by `u32` triangle indices.

The TypeScript decoder returns typed-array views over the packet when alignment allows. This avoids large JSON number arrays and repeated elevation-grid parsing. Printable plans stay in the Rust session. The worker first takes ownership of the final planned terrain mesh, then pulls bounded V-carve packets and insert packets. Every take operation replaces the Rust vectors with empty vectors before encoding, so source allocations are released as soon as ownership crosses the boundary instead of remaining duplicated in the pending plan.

### Browser application

`web/src/main.ts` composes the UI, project state, persistence, source loading, and worker requests. Supporting modules isolate major browser responsibilities:

- `app-shell.ts`: model-area, project, calibration, and export dialogs, composed with `workbench-layout.ts` for the command bar, grouped settings, source management, help, and viewport hosts. `workbench.css` supplies neutral control styling and responsive layouts over the shared component styles.
- `workbench-chrome.ts`: File/View/Model/Tools/Help menus, keyboard navigation, command mirrors, and native source/help dialog lifetimes. Mirrored commands invoke the original handlers and track their disabled, tooltip, and pressed state. Inspection and export availability follows the generated model revision and current processing state.
- `feature-browser.ts`: searchable, collapsible feature tree and one selection-properties editor for a feature, class, or source/class group. Search-result and whole-group scopes are explicit; group inclusion checkboxes always affect all members and say so. Selection, collapse state, and edit scope are transient UI state. Model changes flow through `main.ts` into the existing persistence and worker boundaries; the serialized model is unchanged.
- `providers.ts` and `provider-registry.ts`: raster windows and mosaics, provider selection, USGS/Copernicus catalogs, persistent response caching, and bounded Overpass mirror failover.
- `feature-sources.ts`: curated Overpass, HRC, USFS, NPS, BLM, Washington RCO, and OpenSkiMap entries, validated custom HTTPS endpoints, browser-local library preferences, bounded GeoJSON downloads, complete ArcGIS object-ID batching, WGS84 validation, and source-specific refresh merging. `feature-source-panel.ts` owns the library controls in the Add features / Manage data sources dialog and shares their selection with the new-project wizard. Class selections persist per source in `contour-source-classes-v1`; loads snapshot that selection, filter normalized features, and refresh only selected classes while retaining other classes. Rust owns class-filtered Overpass queries; OpenSkiMap uses its run/lift request filter. Other providers filter after classification. Explicit feature-class and name-field mappings are applied by the Rust normalizer; they do not change the saved Feature contract. The feature tree groups each class by provenance and sorts source names and feature names without reordering saved features. Legacy OSM/county IDs, GPX filenames, and new GeoJSON upload provenance are recognized; other features use an unattributed group.
- `extent-map.ts` and `extent-shapes.ts`: slippy-map drawing and editable shapes.
- `gpx.ts`: validates uploaded GPX XML and converts each track or route into an enabled trail feature with a unique import ID, its GPX name (or filename fallback), and separate lines for track segments. Multiple files append atomically to the active project; imported features use the existing tree controls, terrain clipping, preview, generation, and project persistence. GPX elevation is ignored in favor of terrain elevation; standalone waypoints are not imported.
- `gpx-placement.ts` classifies full line segments against the terrain grid and optional concave boundary. Feature-tree labels distinguish inside, partial, and outside tracks. Zoom shows a temporary unclipped geographic footprint above the terrain; it never enters exported geometry. Fit model clears the guide.
- `filaments.ts` resolves a deterministic color per physical slot. Print-together previews and 3MF exporters share this palette. Legacy conflicting assignments are called out in Print Setup; users can choose distinct slots or normalize shared colors. Changing a slot's color updates its assigned classes together. Separate printing retains class colors.
- `viewer.ts`: Three.js terrain, feature overlays, topographic ground imagery, selection, and review. The floor and topo imagery render first in fixed background order without depth tests or writes; terrain and feature meshes retain normal depth occlusion. This avoids depth fighting between the closely spaced ground planes while panning.
- `annotation-editor.ts` and `annotations.ts`: text/PNG authoring and printable geometry. Text annotations save an optional sans-serif, serif, or monospace font choice; missing/unknown values use sans-serif. The saved raster mask is shared by preview and generation, preserving glyphs across systems until text or font edits rasterize them again. Engraving previews union projected triangles independently into the terrain cut mask so opposite prism faces cannot cancel their footprints.
- `presets.ts`: static landing catalog and prebuilt mesh packs.
- `three-mf.ts` and `three-mf-validation.ts`: portable, Bambu Studio, PrusaSlicer, and service 3MF packages plus mesh, OPC-part, XML, identifier, and build-reference validation.
- `export-client.ts`, `export-worker.ts`, and `export-formats.ts`: one disposable final-export worker, compact transferable mesh copies, target-specific encoding, and strict worker termination.
- `project-files.ts`: filesystem-safe project names, browser downloads, and upload limits.
- `engine-contract.ts` and `client.ts`: a discriminated request/result map, structured progress, and request cancellation for the geometry worker.
- `persistent-cache.ts`: IndexedDB source-data caching with an in-memory fallback and expiration policy.
- `project-store.ts`: durable local project metadata, state, terrain, and generated thumbnails.
- `serialized-contract.ts`: compile-time TypeScript parity with the Rust serialization manifest.

A saved schema-version-2 project contains the elevation grid, provenance, features, annotations, editable extent state, and print settings. It does not depend on a service remaining available after save. Editable file export uses this same schema; local projects split the state and elevation records so frequent edits do not rewrite the large raster.

The viewer computes a standard presentation pose from the highest surface vertex. It places that point toward the back of the scene and frames the terrain from an oblique elevation. Thumbnail rendering uses the same pose in an offscreen render target, without moving the user's active camera.

GeoTIFF, Manifold, and 3MF modules are dynamically imported at their first use. The landing and preset-editing path therefore avoids parsing those heavy implementations until a user downloads terrain, generates printable geometry, or exports 3MF.

### Geometry worker

`web/src/worker.ts` keeps expensive and WASM-backed work off the UI thread. It owns:

- The persistent Rust `TerrainSession`.
- The current terrain mesh and settings.
- Direct Rust terrain pockets, remaining Manifold operations for V-carves and annotations, streamed insert batches, and explicit object deletion through `manifold-adapter.ts`.
- Full edge validation and bounded repair for independent parts. Large terrain exported directly from a successful Manifold solid receives finite-coordinate and triangle-index validation without allocating a second three-edges-per-triangle table.
- A pre-allocation memory estimate that chooses bounded adaptive terrain detail when automatic full detail would exceed the browser-derived build budget.
- Cooperative cancellation checkpoints between V-carve groups, annotations, and insert operations, with forced worker replacement if native WASM work does not yield promptly.
- Calibration geometry, preset packs, and generation results. Final archive encoding is isolated in a disposable export worker.

Changing visibility, treatment, width, or carve depth rebuilds overlays or the final plan without rebuilding terrain. Base-thickness edits shift cached terrain vertices without rebuilding source terrain. A new grid or terrain build replaces the Rust session.

The worker retains its terrain buffer. Responses that cross the worker boundary receive a copy, because transferring the retained buffer would detach it and corrupt later generation. Worker requests and responses are exhaustively typed by operation; adding an operation requires updating the shared map rather than passing an untyped string and payload.

### Manifold compatibility

Manifold performs final solid unions, differences, intersections, taper layers, and annotation booleans. The project pins `manifold-3d` 3.5.4, and dependency upgrades must pass both preset generation tests before changing the pin.

Manifold mesh exports can contain multiple property vertices for one topological vertex. `manifold-adapter.ts` resolves the merge-vector union relation, compacts referenced vertices into typed arrays, and validates directed edges through a sorted numeric buffer. This avoids the string-key maps and boxed number arrays that previously produced large transient allocations on full-resolution terrain. Native topology is preferred over coordinate welding because distinct vertices may be nearly coincident; bounded coordinate welding remains a fallback for malformed exports.

Insert pockets preserve class priority inside Rust. Equal-height pocket regions are unioned, deeper regions claim overlaps, and a constrained terrain triangulation emits the original surface, pocket floors, shared bottom, outer walls, and vertical feature interfaces as one validated mesh. A deterministic bounding-box sweep routes different-height overlaps or shared boundaries to bounded pocket cutters before constrained triangulation, avoiding a known failed-build path on complex presets. Direct pocket boundaries (including holes) and the model outline are sampled at elevation-grid crossings and at most 0.6 mm apart before linework normalization. Each sample receives bilinearly interpolated source elevation; terrain and pocket walls share these constrained vertices so long cut edges cannot bridge over intervening relief, even with adaptive terrain simplification. Touching linework for remaining direct pockets is normalized before the full terrain load. If another pathological junction still fails two-manifold validation, Rust emits the established bounded pocket cutters instead of returning unsafe geometry. Feature patches window the elevation grid to local bounds. V-carves remain bounded class-preserving cutter packets because their sloped profiles still use Manifold subtraction. Each transferred terrain, cutter, and insert mesh is removed from the pending Rust plan as its packet is produced.

The working terrain solid is deleted immediately after export; only then is the extra conformal-terrain solid created for insert fitting. Conformal fitting shifts that temporary solid by each piece's effective signed relative-height offset, replacing it when the offset changes so only one shifted copy is retained. For terrain above one million preview triangles, Three.js releases design geometry and keeps the topo surface visible during generation. These lifetime rules reduce the shared WebContent-process peak while preserving class order and Boolean meaning. Temporary Manifold and CrossSection objects must be deleted in every success and failure path.

## Data flows

### New project

1. The user draws or edits a geographic boundary. Rounded corners are tessellated against the final print scale with a 0.05 mm maximum chord error and a bounded vertex budget.
2. The viewer immediately derives the same print-bed layout used by Rust, shows the USGS topo map (OpenTopoMap internationally), and draws the selected boundary while source data loads.
3. Source policy estimates raster sample count and chooses 10 m, 30 m, or 90 m data for Auto. The browser checks IndexedDB before resolving or downloading tiles.
4. As soon as elevation is available, Rust builds terrain and the viewer replaces the flat map footprint with the fitted terrain mesh.
5. As soon as terrain is ready, the UI restores editing controls and requests supported paths and zones from Overpass in the background. Each attempt has its own abort deadline; transient HTTP/network/runtime-timeout failures rotate through configured mirrors with capped jittered backoff and Retry-After support. A hard attempt/time budget settles the task, successful responses are deduplicated and cached for one day, and project switches cancel stale work. Exhaustion leaves terrain intact and exposes an explicit retry action.
6. Rust normalizes classifications and builds preview overlays. Three.js adds them without rebuilding or hiding the terrain.
7. Feature controls remain editable throughout the completed design preview.

### Feature source library

`Settings.class_priority` stores a complete, highest-first class order. Older models
retain the original water/glacier/ski-run/trail/road/stream/ski-lift order. Import
normalization removes unknown/duplicate names and appends missing classes in that
default order; direct Rust settings validation requires a complete permutation.
The Features panel's accessible move-up/down controls reorder the tree and persist
through normal project edits, invalidating generated output and rebuilding overlays.
Rust uses the same order and occupied footprints to clip lower-priority inserts
and grooves in previews and final plans. Same-class inserts still take precedence
over grooves. Viewer depth bias follows the saved order; material/filament IDs stay
stable regardless of priority.

The Features panel and new-landscape wizard share a source selector. OpenStreetMap
remains the default and retains its existing cache, mirror failover, retry, and
winter behavior. Winter landscape creation explicitly uses Overpass. HRC queries
the county public trail layer within the terrain bounds, with automatic county
classification excluding closed/future trails. Sources load one at a time; users
can combine sources by loading each into the same model.

USFS, NPS, BLM public trails, and Washington RCO use official ArcGIS layers with
the same terrain-envelope queries and complete ID batching as HRC. Each entry
maps the provider's exact trail-name field and explicitly imports trails. BLM
uses the managed-for-public layer, excluding the separate unassessed layer;
Washington uses the current RCO public view's Trails layer, not trailhead points.
Curated descriptions explain coverage beside the selector. These public trail
layers may overlap each other and Overpass; source snapshots remain independent.

OpenSkiMap's public `/features.geojson?bbox=…&types=run,lift` endpoint supplies
terrain-bounded ski GeoJSON without a backend or worldwide download. The browser
enforces the API's 1,000 km² bounding-box limit using its equirectangular formula.
Rust classifies active OpenSkiData run/lift properties and excludes non-ski uses
and inactive features. Browser identity mapping prefers sorted upstream sources;
ambiguous split-feature groups append the content ID. This preserves ordinary
refresh edits but cannot guarantee continuity when split features change. Source
credits travel in `tags.contour_source.attribution` and export attribution files.

Custom library entries (name, HTTPS URL, feature class, optional name field) live
under `contour-feature-sources-v1` in localStorage. Entries can be edited or removed;
removing one does not delete imported model geometry. Separately, `main.ts` renders
loaded sources from feature provenance and removes a chosen source's features
across all classes after confirmation, invalidating generated output, refreshing
overlays, and saving through the normal project-edit path. This action keeps the
library definition, ignores search/class-load filters, and is disabled during
downloads and geometry jobs. Source/class bulk visibility and treatment controls
use the same edit path and apply to search-hidden group members. Storage failure is reported
instead of claiming a definition was saved. Library preferences are separate from
saved projects. Projects embed downloaded geometry and source provenance inside
the existing feature `tags.contour_source` object, so reopening never depends on
network availability or the source library.

GeoJSON endpoints can use `{bbox}` for west,south,east,north. Complete files are
also supported and filtered by geometry bounds before Rust clips them to the
model outline. ArcGIS FeatureServer/MapServer layer URLs (including query URLs)
are detected automatically; the loader requests matching object IDs and downloads
verified batches of 200 in EPSG:4326. Partial responses fail before any project
mutation. Downloads omit browser credentials, require browser CORS access, and
have a 60-second deadline, 50 MB response budget, 20,000-feature limit, and
500,000-coordinate limit. Invalid/projected coordinates, duplicate IDs, unsupported
geometry collections, and known pagination/truncation indicators produce actionable
errors. Point features and null geometries are not printable and are skipped in
plain GeoJSON files; ArcGIS layers must return complete line/polygon batches.

Endpoint loads use stable source-prefixed feature IDs (remote IDs when available,
otherwise a canonical geometry/properties SHA-256 digest). HRC retains the existing
`county-trail:<OBJECTID>` identifiers so refreshing the bundled Post Canyon model
does not duplicate its trails. A successful refresh replaces that source's prior
snapshot, removes disappeared records, and preserves matching visibility,
treatment, surface, width, and insert depth overrides. Other sources and uploads
remain intact. Downloads are fresh on each explicit load; only Overpass uses its
existing persistent cache. The shared cancellation controller and serial/project
guards reject late results after cancellation, navigation, or project replacement.

### Preset project

1. The landing catalog loads a compressed `.cwpack`.
2. The app displays its prebuilt terrain immediately, then adds the linked overlays on the following rendered frame.
3. Overlay identifiers are checked against project feature identifiers.
4. The worker hydrates a Rust session in the background for subsequent edits and generation.
5. Opening a preset remains ephemeral. Its first edit forks it into a new local project identifier and starts autosave.

Post Canyon's trail snapshot comes from Hood River County's public recreation-trail
FeatureServer layer 134. The raw WGS84 GeoJSON lives in
`tests/resources/post_canyon.geojson`; the integration fixture retains its separate
boundary, roads, streams, and elevation grid. Rust recognizes the county's
`Trail_Name` and full `Name` fields and excludes closed/future trails. The preset
uses stable `county-trail:<OBJECTID>` identifiers and regenerated overlay meshes;
its catalog revision must advance with each refresh to invalidate cached bundles.
Download details are recorded in `tests/resources/README.md`.

### Local project sessions

1. The first meaningful edit to a preset, or creation/import of a new design, assigns a UUID. Merely viewing a preset creates no local record.
2. A short debounce writes project state and metadata to IndexedDB. The elevation grid has a separate record and is rewritten only when its identity changes.
3. After the scene settles, Three.js renders a 640 × 360 WebP thumbnail from the standard presentation pose. The landing page resolves thumbnail blobs to temporary object URLs.
4. Returning users can open, rename, duplicate, export, or delete recent projects from the landing page. Opening restores the complete saved project and terrain without fetching source services.
5. IndexedDB failures fall back to memory for the current visit. The app requests persistent browser storage after the first local save when the browser exposes that capability.

### Printable generation

1. Before final geometry allocation, the worker estimates the build peak from source samples, preview triangles, and enabled features. Automatic full detail is replaced with a bounded sampled-error target when the estimate exceeds 72 percent of the browser-derived budget; an explicit user detail target is preserved.
2. Rust constructs insert bodies and the final terrain directly. Constrained surface regions share canonical XY interface coordinates, while each top region owns the height needed for terrain, pocket floors, and vertical walls.
3. The worker takes and releases that terrain allocation, then applies remaining V-carve and annotation operations through Manifold. Plans whose direct pocket junctions fail topology validation include bounded fallback pocket cutters in the same streamed cutter path.
4. Rust streams bounded insert packets. Separate mode can taper them; print-together mode keeps exact interface coordinates and zero fit clearance. Conformal intersections use a separately scoped shifted preview-terrain solid.
5. Independent pieces receive full edge validation. The direct terrain is validated by Rust before transfer and Manifold validates any subsequent solid operation.
6. Separate mode enters Review with the terrain and linked insert pieces. Print-together uses `painted-surface.ts` to union temporary zero-clearance regions into one exterior mesh. Manifold original-face provenance becomes a compact per-triangle material array; internal partition faces are discarded. Temporary construction depth is fixed independently of insert-depth settings, and a buried 1 µm overlap prevents Float32 round trips from leaving disconnected floor shells. Raised, recessed, level, and conformal surface shapes remain geometry. The persistent interactive worker retains preview state; final archive encoding uses a separate disposable worker.

### Download

The UI copies generated meshes into compact typed arrays and transfers ownership to a newly created export worker. Feature-source credits are folded into the compact export source attribution before transfer, without copying feature geometries or changing the original project. The worker encodes one selected target, transfers the completed bytes back, and closes. The client also terminates it after success, failure, or cancellation. This keeps archive strings, texture data, and duplicate geometry out of the persistent preview/generation worker.

- STL creates a ZIP with terrain and insert files, project data, origins, validation, and attribution.
- The download dialog offers STL parts or 3MF, with standard, Bambu Studio, and PrusaSlicer choices nested under 3MF. Manufacturing mode is chosen before generation and is independent of file format.
- STL bundles use local insert coordinates for separate assembly. Print-together exports only the exterior shape; STL cannot retain painted colors, which the download dialog and bundle README explain.
- Standard and PrusaSlicer 3MF place separate inserts flat and apart as independent build objects for the slicer to arrange; print-together retains assembly coordinates. PrusaSlicer groups print-together parts into one build object and uses per-object adaptive layer profiles for separate printing. Both modes include a complete slot-indexed filament/extruder palette and nozzle array, plus native Slic3r_PE_model.config volume assignments and triangle ranges. The PrusaSlicer 2.x compatibility marker selects the legacy project reader; Designer retains Contour Workbench attribution. Printer-specific packing remains Bambu-only; Prusa users arrange parts for their selected printer.
- Bambu 3MF includes required filament palettes and installed printer/process/PLA preset references plus explicit difference lists. This avoids the native importer dereferencing a missing palette before defaults are applied, and lets omitted machine G-code, temperatures, and other settings inherit the selected presets. Only intentional process/color overrides are embedded. Users select their actual filament in the slicer.
- Bambu Studio print-together 3MF contains one painted mesh with native `paint_color` triangle assignments and the filament palette. PrusaSlicer uses native `mmu_segmentation` assignments; standard 3MF uses triangle base-material colors. Only the exterior is specified: slicers determine material penetration, walls, and infill. Review renders the same face-material array, and the disposable export worker receives a separate transferable copy.
- Legacy service encoders remain internal; service-specific formats are no longer presented in the download dialog.
- Separate manufacturing uses fit clearance, taper, segmentation, insert depth, and optional enclosed terrain-pin removal. Print-together disables those controls and preserves terrain islands while constructing its exterior.
- 3MF variants validate mesh indices, required OPC parts, XML syntax, core namespace/units, object identifiers, and build references before the archive is returned.

Bambu downloads select a P1S, X1 Carbon, A1, or A1 mini layout independently of the serialized geometry settings. The selection crosses both worker contracts as export options. The shared encoder writes sparse process overrides and printer identity/bed metadata, leaving machine G-code and temperatures to the slicer. Separate-part Bambu and Prusa exports split conflicting class colors that share a legacy filament slot into free slots, preserving distinct existing slots and shared matching colors. Only exported classes determine the palette. Default Post Canyon therefore retains terrain, trail, road, and stream filaments. Separate parts use deterministic multi-order first-fit rectangle packing, including filament-grouped candidate orders. Single-filament plates use by-layer printing with an 8 mm gap (two 3 mm brims plus 2 mm separation), without sequential height constraints. Mixed-filament plates use by-object printing with printer clearance and at most one part above rod height (printed last); low-only mixed plates use the native nozzle-clearance tier. Adding another filament revalidates all existing plate objects and gaps. Both separate-part packing modes respect mechanical exclusions and printer-specific rectangular purge-line keepouts on every plate. Keepouts include bead/wipe allowance; collision tests expand object bounds by the existing 4 mm margin (3 mm brim plus 1 mm tolerance). Candidate positions include keepout edges so usable bed area is still considered. P1S/X1 envelopes cover all supported nozzle sizes and X1 calibration strokes; A1/A1 mini envelopes include front-edge purge/wipe exits. Coordinates were checked against the official [Bambu Studio start-code profiles](https://github.com/bambulab/BambuStudio/tree/79df7ae309be398ed30c9f397c13c9911c2edc57/resources/profiles/BBL/machine). These are stock-profile placement limits; custom start code or rearrangement in the slicer can change the required area. Parts that cannot fit with these allowances fail explicitly instead of overlapping the purge line. The project default is by-layer, with an explicit sequence on every native plate and in the export manifest. Packing is heuristic, not a global optimum. Native plate origins use a ceil(sqrt(count)) grid and 20% bed gap. Object IDs and layer profiles follow print order. Fit coupons and standard exports may use up to 36 plates in one file. Print-together exports retain by-layer behavior. Users must select matching printer/nozzle and validate slicing; changing clearance-related settings requires rearrangement.

`painted-export.spec.ts` generates deterministic three-color flush, raised, and recessed fixtures. After slicing these files with Bambu Studio's CLI, `web/scripts/verify-bambu-painted.py` checks actual top-surface extrusion positions, filament usage, object count, and heights, accounting for machine nozzle offsets and layer quantization. Bambu Studio 2.5.0.66 was used for the initial integration verification. This is slicer validation, not a physical print test.

Painted mesh validation also checks connected surface components. Boolean roundoff can leave microscopic closed shells at coincident interfaces; only shells with absolute volume at most 0.001 mm³ and volume/area at most 0.00005 mm are discarded. A larger detached component rejects generation instead of silently removing a real feature. Per-triangle materials remain aligned through this cleanup.

Painted assembly uses balanced native unions in batches of at most 32 regions, with progress and cancellation checkpoints between batches. The conformal fitting solid is released before assembly. This avoids repeating a full-terrain union for every small feature while bounding temporary solid ownership.

Print Setup hides assembly-only controls in print-together mode and shows the physical filament mapping before export. `multicolor-coupon.ts` constructs a fixed 60 × 42 mm three-filament coupon with a front-left notch, recessed/flush/raised rows, four nozzle-scaled line widths, and area patches. The bounded `color-calibration` worker operation returns a Bambu 3MF with a dimensional legend and print-inspection instructions; it does not modify the active project. Like the existing fit coupon, this tiny calibration archive is encoded within its worker operation rather than the large-model export worker.

### Remaining scaling boundary

Validated feature-aware insert pockets no longer require full-terrain Manifold subtraction; pathological multi-height junctions use bounded Manifold pocket batches as a correctness fallback. Full-detail grid faces are constructed in seam-sharing tiles, adaptive builds avoid allocating a discarded full-resolution face list, and local feature patches use bounded grid windows. The current serialized terrain is still one global indexed mesh, and V-carves, annotations, conformal fitting, and insert taper still require Manifold. If future source limits grow beyond the current two-million-sample ceiling, the next step is streaming independently validated terrain tile packets into export assembly while retaining the canonical interface and disposable export-worker contracts.

## Source and geometry constraints

- Geographic bounds are limited to two degrees per side, latitude ±85 degrees, and two million elevation samples.
- Only geographic WGS84/NAD83 GeoTIFFs are accepted.
- Auto targets at most one million samples: USGS 10 m for small US areas, 30 m for larger areas, and Copernicus 90 m for giant areas.
- Overpass availability and coverage can vary. The registry retries only transient failures across three configurable public mirrors, with per-attempt and total deadlines; permanent request errors are reported immediately. Feature failure never blocks terrain editing. The current query remains a single bounded-area request, so unusually dense areas can exhaust all public mirrors and require a later retry. OSM multipolygon holes are retained.
- Elevation results are cached for 30 days and OSM responses for one day. IndexedDB failures degrade to normal uncached requests.
- Preview overlays communicate the effective signed insert relative height, but final boolean fit is calculated during Generate. A zero value uses render-only polygon/depth bias, while a negative value uses a render-only surface opening and boundary wall; neither display treatment changes exported coordinates.
- Paths, V-carves, zones, insert pockets, and preview overlays retain the configured model-edge clearance. Insert footprints account for pocket clearance so the terrain margin remains intact after the pocket expands.
- Large inserts retain a configurable terrain floor. Inserts remain continuous unless segmentation is explicitly enabled.
- Watertight validation is a topology guarantee, not a printer or material guarantee.

## Tests and deployment

`scripts/check.sh` installs web dependencies once, then runs Rust formatting, strict Clippy, Rust tests, Prettier verification, TypeScript checking, Vitest, the WASM build, and the production Vite build. `scripts/build-wasm.sh` owns binding generation so CI and local checks do not repeat dependency installation or TypeScript checking.

Playwright mobile tests cover the landing flow, durable local projects and thumbnails, responsive settings, feature controls, shape settings and persistence, annotations, 3MF download choices, and repeated generation. Preset tests build Post Canyon, Mt. Hood Meadows, and the switchback/terrain calibration coupon, catching geometry-lifetime and watertightness regressions. Sequential export coverage verifies printer choice across both worker paths, real coupon relief, safe multi-plate A1 mini calibration, and multi-plate regular exports after calibration. Prior flat-coupon Bambu Studio 2.5.0.66 native GUI imports and slicing validated P1S and A1 mini coupons plus a two-plate A1 mini terrain project; a native save confirms inherited machine settings and retained variable layer profiles.

`.github/workflows/validate.yml` runs the complete validation suite for pull requests without deployment. `.github/workflows/contour-pages.yml` repeats the release gate on pushes to `main`, uploads `web/dist`, and deploys it through GitHub Pages. Both workflows can also be run manually. Browser setup downloads the locked Playwright Chromium version and uses the hosted Ubuntu runner's existing system libraries, avoiding slow OS package updates. Browser launch validation and all test gates remain required.

Rust unit tests serialize every shared core model and compare its field names and enum values with `web/src/serialized-contract.json`. TypeScript compile-time checks and Vitest compare that JSON with the literal TypeScript manifest, making field drift fail CI on either side.

### Direct full-color print ordering

`PrintOrderDialog` owns the Marketiger customer-account session, quote, address form, and explicit order confirmation. `MarketigerClient` calls the production v2 API directly with CORS, bearer authentication, omitted cookies, and a one-minute request timeout. This adds no backend, shared credentials, or infrastructure. Marketiger must assign each customer a full-color project and enable API ordering and Stripe Checkout. Project discovery exposes no payment configuration, so the UI requires the customer to confirm that configuration before creating an order. No pricing or fulfillment guarantee is inferred from project discovery.

The disposable export worker's `marketiger` format requires the generated Print together exterior and per-face material IDs. It produces one millimeter-scale OBJ, MTL and exact RGB palette PNG, with white diffuse multipliers to preserve texture colors. Filament/extruder assignments do not affect this package. Original GPX tracks and the project document are excluded; source attribution remains. Separate-insert models must be regenerated in Print together mode before ordering. Bounds and enclosed volume accompany the worker result. The provider must report processed status, matching dimensions (0.5% or 0.1 mm tolerance), one connected part, a price and a preview before checkout becomes available.

A SHA-256 digest of the deterministic ZIP binds reuse to the exact print package. The single latest recovery receipt in localStorage contains only that fingerprint, project/model/order IDs, unique upload filename, and pending-operation markers. No credentials, address, payment URL, or image URL are persisted. Closing the dialog aborts work and discards the bearer token. Project changes invalidate the open quote. Shipping is recalculated for quantity/country changes; service-point methods are excluded because the documented order API has no pickup-location field. Prices are displayed in EUR excluding VAT, with the final amount owned by Marketiger.

Uploading and order creation are never automatically retried. A marker is persisted before each mutation; interrupted or unreadable responses require inspection in Marketiger HUB before another attempt. Successful responses save model/order IDs for reconnection. Polling is user initiated via Check processing / Refresh order status, avoiding indefinite background work. An explicit confirmation authorizes order creation; payment happens only via the returned HTTPS checkout.stripe.com link. Missing payment links direct the customer to the existing order in HUB. Only provider order status is used to report payment, never a redirect. Real production ordering requires an activated customer account; automated browser tests use contract fixtures and cannot certify a physical print or account-specific checkout setup.

PrusaSlicer 2.7.2 CLI import/export round trips validate the fit coupon (5 objects) and Post Canyon (59 objects): all filament colors, slot assignments, per-volume triangle counts, and adaptive layer profiles survive. The coupon also slices successfully. "web/scripts/verify-prusa-roundtrip.py" compares exported projects against native 3MF plus the CLI's separately saved configuration. This verifies the native importer and slicing, not printer-specific arrangement or a physical print.

Browser reloads (including hard reloads) explicitly check the service-worker registration for an update and request activation once it is installed. They use the same all-window durable-save handshake as the update button, including uncontrolled hard-reload clients. Background update discovery remains non-disruptive. A blocked reload update remains available for an explicit retry rather than looping. Update-button requests remain pending if the browser replaces a waiting worker during installation; late installation events preserve postponement reasons.

Insert planning computes the lowest surface and flat base independently for each connected footprint within a segmentation cell. Disconnected pieces of one feature class no longer share the cell-wide minimum elevation. Matching pocket floors use that same local base with the existing substrate clearance and structural-floor limits; deliberately level zones keep their shared top elevation.

Annotation rasterization uses 512 × 192 pixels for text and up to 512 × 512 for PNGs. Marching squares traces the half-coverage outline of the saved binary mask, preserving holes and separating diagonal foreground contacts. Horizontal bands decompose that outline into trapezoids (including triangular caps), and collinear sides merge vertically. This replaces pixel-stepped boundaries with interpolated sloped edges; the binary source still limits recoverable detail. Flat porches use one solid per patch; terrain patches subdivide at 1 mm intervals across their width and along their vertical and sloped-side displacement for surface sampling. Saved masks remain authoritative until text, font, or image edits rerasterize them.

Different-height touching pocket pairs use bounded Boolean cutters while independent pockets retain direct terrain meshing. Fallback cutter batches union their solids before subtraction to avoid self-intersecting concatenated meshes. Conformal inserts are fitted to the terrain before taper validation, so thin pieces are checked against their actual printed height. Polygon cleanup remains cell-wide before per-footprint floor calculation, preserving existing fragment rejection.
