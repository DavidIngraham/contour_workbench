# Repository Guidelines

## Project Structure and Architecture

Contour Workbench is a static TypeScript browser application backed by a Rust geometry core. Keep deterministic geometry, classification, and mesh planning in `crates/terrain-core`; keep serialization and transport in `crates/terrain-wasm`; and place command-line workflows in `crates/terrain-cli`. Browser UI, workers, providers, persistence, and exports live under `web/src`. Rust integration fixtures are in `crates/terrain-core/tests` and `tests/resources`; Vitest suites are in `web/tests`, while Playwright mobile and performance coverage lives in `web/mobile-tests` and `web/performance-tests`. Update `HLD.md` when changing component ownership, data flow, caching, persistence, providers, or deployment.

## Build, Test, and Development Commands

- `bash scripts/build-web.sh`: install web dependencies, rebuild WASM, and create the production web bundle.
- `cd web && npm run dev`: start Vite for browser development.
- `bash scripts/check.sh`: run the full Rust and web quality gate, including formatting, Clippy, tests, WASM generation, and the Vite build.
- `cargo test --workspace`: run all Rust tests.
- `cd web && npm run check`: check Prettier formatting, TypeScript types, and Vitest tests.
- `cd web && npm run test:mobile`: run responsive Playwright scenarios.
- `cd web && npm run test:presets`: validate geometry, worker, insert-fit, and export-sensitive changes.

## Coding Style and Naming

Use Rust 2021 formatting from `rustfmt.toml`: four-space Rust indentation and a 100-column limit. Web code uses two spaces, single quotes, semicolons, trailing commas, and Prettier's 100-column width. Use `snake_case` for Rust items, `camelCase` for TypeScript values, and `PascalCase` for types. Include units in physical-value names (for example, `_mm`); represent geographic pairs as `[longitude, latitude]`. Document public Rust APIs and exported TypeScript APIs. Comments should explain invariants, ownership, transforms, or geometry tradeoffs.

## Tests, Commits, and Pull Requests

Add focused regression tests beside the affected layer. Serialized-model changes must update both files in `web/src/serialized-contract.*`. Preserve deterministic geometry and explicitly test cancellation or ownership at WASM and worker boundaries. Use short, imperative commit subjects consistent with history, such as `Add memory-safe multicolor export pipeline`. Keep commits single-purpose and separate formatting-only changes when practical. Pull requests should summarize behavior and architecture impact, list commands run, link issues, and include screenshots for visible UI changes. Never commit generated WASM, `web/dist`, dependencies, Playwright artifacts, secrets, or private API credentials.
