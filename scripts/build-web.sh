#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .tools/env.sh ]; then source .tools/env.sh; fi
cargo build --release --target wasm32-unknown-unknown -p contour-wasm
wasm-bindgen target/wasm32-unknown-unknown/release/contour_wasm.wasm --target web --out-dir web/src/wasm
cd web
npm ci
npm run build
