#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bash scripts/build-wasm.sh

cd web
npm ci
npm run build
