# Contour Workbench

Design printable landscapes in your browser with Rust/WASM and Three.js. Draw a polygon on an OpenStreetMap slippy map, load elevation, choose paths and polygon zones, and export terrain with fitted inserts.

- Full source resolution by default; optional adaptive simplification.
- Concave polygon extents with draggable vertices, undo, and redraw.
- USGS 3DEP, geographic GeoTIFF imports, and Copernicus download links.
- Direct OpenStreetMap queries for paths, water, glaciers, ski runs, and lifts, plus GeoJSON imports.
- Winter mode with broad white ski-run inserts and chair-lift grooves.
- Continuous shallow zone inlays retain a supporting terrain floor and multipolygon islands.
- Instant feature toggles, solid review, and STL bundles.
- Static hosting on GitHub Pages. No Python runtime or backend.

## Build and run

Install Node.js 22+ and Rust. From the repository root:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.100 --locked
bash scripts/build-web.sh
cd web
npm run dev
```

See [the app guide](web/README.md) for testing, source limitations, and GitHub Pages deployment.

## Repository

- `crates/terrain-core`: terrain, polygon clipping, classifications, and inserts.
- `crates/terrain-wasm`: browser bindings.
- `crates/terrain-cli`: native terrain export.
- `web`: TypeScript, Leaflet, Three.js, and the solid generation worker.
- `tests/resources`: geographic fixtures.
- `docs/reference-parts`: original reference STL parts.

Legacy Python code, tests, configuration, and dependencies have been removed. Feature classifications now live in Rust.

## Checks

```sh
cargo test --workspace
cd web
npm test
npm run build
# With the dev server on port 5173:
npx playwright install chromium
node tests/smoke.mjs
node tests/polygon-smoke.mjs
node tests/zone-cases.mjs
```

### Nozzle-aware insert fit

Print setup records nozzle diameter (0.4 mm by default), pocket clearance per side, lower-layer elephant-foot relief, taper height, and assembly draft. Generated inserts keep a full-width seating band at the visible surface and taper only the buried geometry. Thin line inserts clamp the taper so their first layer remains at least one extrusion wide. Every print bundle includes a numbered four-fit calibration coupon, which can also be downloaded independently before generating a terrain model.
