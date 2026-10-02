#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [ -f .tools/env.sh ]; then
  # Local checkout convenience; CI provides its own toolchain.
  source .tools/env.sh
fi

cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings -A clippy::chunks-exact-to-as-chunks
cargo test --workspace

cd web
npm ci
npm run check
cd ..

bash scripts/build-wasm.sh
cd web
npx vite build
