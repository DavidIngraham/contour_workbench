#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .tools/env.sh ]; then
  # Local checkout convenience; CI provides its own toolchain.
  source .tools/env.sh
fi

cargo build --release --target wasm32-unknown-unknown -p contour-wasm
wasm-bindgen \n  target/wasm32-unknown-unknown/release/contour_wasm.wasm \n  --target web \n  --out-dir web/src/wasm
