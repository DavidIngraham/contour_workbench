# Contour Workbench

Contour Workbench turns elevation and map features into printable terrain models entirely in the browser. Draw or edit a geographic extent, load elevation, import OpenStreetMap features, choose inserts or V-carves, preview the result, and export STL or 3MF files.

[Open Contour Workbench](https://davidingraham.github.io/contour_workbench/)

## Highlights

- Full source resolution by default, with optional gradient-driven simplification.
- Freeform, spline, square, rectangle, and circle extents with editable dimensions and corner radii.
- USGS 3DEP, geographic GeoTIFF imports, and Copernicus download links.
- Direct OpenStreetMap queries with mirror failover and local response caching.
- Per-feature visibility and Insert/V-carve treatment controls.
- Nozzle-aware insert clearance, taper, elephant-foot relief, and a calibration coupon.
- Text and monochrome PNG annotations on the terrain or an attached porch.
- Separate STL files, portable assembled 3MF, and Bambu Studio multi-plate 3MF.
- Static hosting on GitHub Pages, with lazily loaded geometry tools and processing performed locally.

## Repository layout

- `crates/terrain-core`: platform-independent terrain, classification, overlay, insert, and cutter geometry.
- `crates/terrain-wasm`: stateful browser bindings and packed binary mesh transport.
- `crates/terrain-cli`: minimal native terrain-to-STL command.
- `web/src`: TypeScript application, data providers, Three.js viewer, and geometry worker.
- `web/tests`: deterministic Vitest unit tests.
- `web/mobile-tests`: responsive and touch-oriented Playwright checks.
- `web/performance-tests`: full preset and calibration model generation checks.
- `web/public/examples`: landing catalog, screenshots, and prebuilt preset packs.
- `tests/resources`: geographic fixtures used by Rust tests.

See [HLD.md](HLD.md) for architecture and data flow, [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions, and [web/README.md](web/README.md) for user-facing behavior and provider limits.

## Build and run

Install Node.js 22+, Rust stable, the WebAssembly target, and the matching binding tool:

```sh
rustup target add wasm32-unknown-unknown
rustup component add rustfmt clippy
cargo install wasm-bindgen-cli --version 0.2.100 --locked
bash scripts/build-web.sh
cd web
npm run dev
```

The production site is emitted to `web/dist`.

## Validate changes

Run the maintained formatter, lint, unit-test, and production-build checks from the repository root:

```sh
bash scripts/check.sh
```

Install Chromium once, then run responsive and full-generation browser checks when UI or geometry behavior changes:

```sh
cd web
npx playwright install chromium
npm run test:mobile
npm run test:presets
```

Pull requests run the validation workflow. Pushes to `main` repeat the release gate and deploy GitHub Pages automatically.
