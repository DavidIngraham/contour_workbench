# Contributing

Contour Workbench is a static browser application with a Rust geometry core. Keep geometry rules in `terrain-core`, keep browser-only concerns in `web`, and keep the WASM layer focused on serialization and transport.

## Development setup

Install Node.js 22+, Rust stable, `rustfmt`, `clippy`, the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` 0.2.100. Then run:

```sh
bash scripts/build-web.sh
cd web
npm run dev
```

The optional `.tools/env.sh` is a local convenience used by this checkout and is not required.

## Formatting and checks

- Rust formatting is defined by `rustfmt.toml`.
- TypeScript, JavaScript, CSS, HTML, and web configuration use Prettier.
- Public Rust APIs require rustdoc comments.
- Exported TypeScript APIs and non-obvious ownership or geometry rules should have TSDoc.
- Physical quantities include their unit in the field or parameter name. Geographic pairs are `[longitude, latitude]`.
- Comments should explain invariants, ownership, coordinate transforms, or geometry tradeoffs rather than restating syntax.

Run the baseline local check:

```sh
bash scripts/check.sh
```

For focused iteration:

```sh
cargo fmt --all
cargo test --workspace
cd web
npm run format
npm run check
```

Run `npm run test:mobile` for responsive UI work and `npm run test:presets` for changes to Rust geometry, the worker, Manifold operations, insert fit, preset packs, or export logic. Use `bash scripts/build-wasm.sh` when only the Rust/WASM boundary changed.

When a serialized Rust model changes, update `web/src/serialized-contract.ts` and `web/src/serialized-contract.json` together. Rust and TypeScript parity tests deliberately fail until both sides agree.

When replacing a bundled preset at the same asset URL, increment its `revision` in `web/public/examples/catalog.json` so browsers do not reuse the previous IndexedDB entry.

## Change boundaries

Prefer small commits with one purpose. Keep formatting-only changes separate from behavior changes when practical. Generated WASM, build output, dependencies, and Playwright artifacts are ignored and must not be committed.

The Rust core returns deterministic meshes and geometry plans. The worker owns Manifold objects and must delete temporary WASM-backed objects explicitly. Never transfer the worker's retained terrain buffer directly to the UI; send a copy so cached geometry remains usable.

Update [HLD.md](HLD.md) whenever a change affects component responsibilities, data flow, the WASM packet, caching, providers, persistence, or deployment.
