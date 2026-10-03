#!/usr/bin/env bash
# Fills a LOCAL validator with campaigns in all four states.
#
# Run from the repo root. Node resolves node_modules from the script's own
# directory, so seed-local.ts is pointed at the program workspace's deps.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

NODE_PATH="$PWD/program/node_modules" npx --prefix program tsx scripts/seed-local.ts
