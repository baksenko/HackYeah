#!/usr/bin/env bash
# Build the program for devnet (Circle's devnet USDC), deploy it, then copy the
# fresh IDL, types and error codes into the frontend so the app always talks
# to what was actually deployed.
#
#   ./scripts/deploy-devnet.sh
#
# Needs the deploy wallet (solana config get) funded with devnet SOL, and
# program/target/deploy/fundraiser-keypair.json whose address matches
# declare_id! in program/programs/fundraiser/src/lib.rs -- see README,
# "Deploying to devnet".
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

CLUSTER="https://api.devnet.solana.com"
DEVNET_USDC="4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
KEYPAIR="program/target/deploy/fundraiser-keypair.json"

echo "==> Deploy wallet: $(solana address)  balance: $(solana balance --url "$CLUSTER")"

echo "==> Building for devnet"
(cd program && anchor build -- --features devnet)

# A program only accepts calls at the address it declares. Deploying with a
# keypair for a different address gives a program that rejects everything.
PROGRAM_ID="$(solana address -k "$KEYPAIR")"
DECLARED="$(grep -o 'declare_id!("[^"]*")' program/programs/fundraiser/src/lib.rs | cut -d'"' -f2)"
if [ "$PROGRAM_ID" != "$DECLARED" ]; then
  echo "!! $KEYPAIR is for $PROGRAM_ID, but the program declares $DECLARED." >&2
  echo "!! Restore the original keypair, or run 'anchor keys sync' in program/ and rerun this script." >&2
  exit 1
fi

MINT="$(node -e "console.log(require('./program/target/idl/fundraiser.json').constants.find(c => c.name === 'USDC_MINT').value)")"
if [ "$MINT" != "$DEVNET_USDC" ]; then
  echo "!! The build accepts mint $MINT, not devnet USDC ($DEVNET_USDC). Was --features devnet applied?" >&2
  exit 1
fi
echo "==> Program ID: $PROGRAM_ID   USDC mint: $MINT"

echo "==> Deploying to devnet"
solana program deploy \
  --url "$CLUSTER" \
  --program-id "$KEYPAIR" \
  program/target/deploy/fundraiser.so

echo "==> Syncing IDL, types and error codes into the frontend"
mkdir -p app/src/idl
cp program/target/idl/fundraiser.json app/src/idl/fundraiser.json
cp program/target/types/fundraiser.ts app/src/idl/fundraiser.ts
node -e "
const idl = require('./app/src/idl/fundraiser.json');
const lines = idl.errors.map((e) => '  ' + e.name + ': ' + e.code).join(',\n');
require('fs').writeFileSync('app/src/idl/fundraiser_errors.ts',
  '// Generated from the IDL by scripts/deploy-devnet.sh.\n' +
  'export const FundraiserErrorCode = {\n' + lines + '\n};\n\n' +
  'export type FundraiserErrorName = keyof typeof FundraiserErrorCode;\n');
"

echo
echo "Deployed. Program ID: $PROGRAM_ID"
echo "Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
