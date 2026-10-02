# Contour Workbench architecture

Status: implemented architecture, October 2026.

## Purpose

Contour Workbench is a static, client-side application for designing printable terrain models. It combines elevation rasters and map features, previews the effective design in Three.js, and creates validated terrain, insert, and carved geometry without a backend.

The browser is the trust boundary for uploaded files and downloaded models. Remote services provide source data only; project editing and mesh generation stay on the user's device.

## System context

```mermaid
flowchart LR
  User[User] --> UI[TypeScript application]
  UI --> USGS[USGS TNM catalog and GeoTIFFs]
  UI --> COP[Copernicus S3 download links]
  UI --> OSM[OpenStreetMap Overpass API]
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
- Full-resolution and adaptive terrain triangulation.
- Polygon clipping for arbitrary terrain extents.
- Preview overlays, V-carve geometry, insert prisms, pockets, and zone floors.
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

The TypeScript decoder returns typed-array views over the packet when alignment allows. This avoids large JSON number arrays and repeated elevation-grid parsing.

### Browser application

`web/src/main.ts` composes the UI, project state, persistence, source loading, and worker requests. Supporting modules isolate major browser responsibilities:

- `providers.ts`: USGS catalog access, raster windows and mosaics, local GeoTIFFs, and Overpass.
- `extent-map.ts` and `extent-shapes.ts`: slippy-map drawing and editable shapes.
- `viewer.ts`: Three.js terrain, feature overlays, topographic ground imagery, selection, and review.
- `annotation-editor.ts` and `annotations.ts`: text/PNG authoring and printable geometry.
- `presets.ts`: static landing catalog and prebuilt mesh packs.
- `three-mf.ts`: portable and Bambu-oriented 3MF packages.
- `client.ts`: request/response protocol for the geometry worker.

A saved schema-version-2 project contains the elevation grid, provenance, features, annotations, editable extent state, and print settings. It does not depend on a service remaining available after save.

### Geometry worker

`web/src/worker.ts` keeps expensive and WASM-backed work off the UI thread. It owns:

- The persistent Rust `TerrainSession`.
- The current terrain mesh and settings.
- A cached base Manifold solid.
- Manifold boolean operations and explicit object deletion.
- Watertight export validation and bounded repair attempts.
- STL bundles, calibration geometry, preset packs, and generation results.

Changing visibility, treatment, width, or carve depth rebuilds overlays or the final plan without rebuilding terrain. Base-thickness edits shift cached terrain vertices and invalidate only the Manifold solid. A new grid or terrain build invalidates the Rust session and cached solid.

The worker retains its terrain buffer. Responses that cross the worker boundary receive a copy, because transferring the retained buffer would detach it and corrupt later generation.

### Manifold compatibility

Manifold performs final solid unions, differences, intersections, taper layers, and annotation booleans. The project pins `manifold-3d` 3.4.1. Version 3.5.4 produced a small number of multiply shared edges in the Mt. Hood Meadows result under the project's strict validator, so upgrades require both preset generation tests before changing the pin.

Manifold mesh exports include merge vectors. The worker resolves that topology before coordinate welding and watertightness checks. Temporary Manifold and CrossSection objects must be deleted in every success and failure path.

## Data flows

### New project

1. The user draws or edits a geographic boundary.
2. Source policy estimates raster sample count and chooses 10 m, 30 m, or 90 m data for Auto.
3. USGS data loads directly where available. Copernicus currently supplies tile download links for local GeoTIFF import because the source bucket lacks browser CORS headers.
4. The UI asks Overpass for supported paths and zones.
5. Rust normalizes classifications and builds terrain and preview overlays.
6. Three.js displays the effective design while feature controls remain editable.

### Preset project

1. The landing catalog loads a compressed `.cwpack`.
2. The app displays its prebuilt terrain and overlays immediately.
3. Overlay identifiers are checked against project feature identifiers.
4. The worker hydrates a Rust session in the background for subsequent edits and generation.

### Printable generation

1. Rust builds insert pieces and ordered cutter groups.
2. The worker imports or reuses the base Manifold terrain.
3. It applies grouped pockets and V-carves, conformal intersections, insert taper, annotations, and porches.
4. Each output mesh is welded and checked for finite, nondegenerate, closed, consistently oriented topology.
5. The UI enters Review mode with a validated terrain and linked insert pieces.

### Download

- STL creates a ZIP with terrain and insert files, project data, origins, validation, attribution, and the calibration coupon.
- Portable 3MF places terrain and inserts in assembly coordinates.
- Bambu 3MF puts terrain on plate one, shelf-packs inserts onto later configured-bed plates, and includes nozzle-derived process hints without binding to a printer or filament profile.

## Source and geometry constraints

- Geographic bounds are limited to two degrees per side, latitude ±85 degrees, and two million elevation samples.
- Only geographic WGS84/NAD83 GeoTIFFs are accepted.
- Auto targets at most one million samples: USGS 10 m for small US areas, 30 m for larger areas, and Copernicus 90 m for giant areas.
- Overpass availability and coverage can vary. OSM multipolygon holes are retained.
- Preview overlays communicate effective placement but final boolean fit is calculated during Generate.
- Large inserts retain a configurable terrain floor. Inserts remain continuous unless segmentation is explicitly enabled.
- Watertight validation is a topology guarantee, not a printer or material guarantee.

## Tests and deployment

`scripts/check.sh` runs Rust formatting, strict Clippy, Rust tests, the WASM build, Prettier verification, TypeScript checking, Vitest, and the production Vite build.

Playwright mobile tests cover the landing flow, responsive settings, feature controls, shape settings and persistence, annotations, 3MF download choices, and repeated generation. Preset tests build Post Canyon, Mt. Hood Meadows, and the switchback calibration coupon, catching geometry-lifetime and watertightness regressions.

`.github/workflows/contour-pages.yml` runs the full checks on every push to `main`, uploads `web/dist`, and deploys it through GitHub Pages. The workflow can also be run manually.
