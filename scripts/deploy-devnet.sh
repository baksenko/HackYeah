#!/usr/bin/env bash
# Build and deploy the program to devnet, then copy the fresh IDL and types
# into the frontend so the app always talks to what was actually deployed.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

CLUSTER="https://api.devnet.solana.com"

echo "==> Deploy wallet: $(solana address)  balance: $(solana balance --url "$CLUSTER")"

echo "==> Building"
(cd program && anchor build)

PROGRAM_ID="$(solana address -k program/target/deploy/fundraiser-keypair.json)"
echo "==> Program ID: $PROGRAM_ID"

echo "==> Deploying to devnet"
solana program deploy \
  --url "$CLUSTER" \
  --program-id program/target/deploy/fundraiser-keypair.json \
  program/target/deploy/fundraiser.so

echo "==> Syncing IDL into the frontend"
mkdir -p app/src/idl
cp program/target/idl/fundraiser.json app/src/idl/fundraiser.json
cp program/target/types/fundraiser.ts app/src/idl/fundraiser.ts

echo
echo "Deployed. Program ID: $PROGRAM_ID"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
