#!/usr/bin/env bash
# Top up devnet wallets for the demo.
#
#   ./scripts/airdrop.sh                       # the CLI deploy wallet
#   ./scripts/airdrop.sh <ADDRESS> [<ADDRESS>] # e.g. your Phantom/Solflare keys
#
# Devnet caps each airdrop at 2 SOL and rate-limits by IP, so this asks in
# 1 SOL steps and keeps going on failure. If it dries up, use the web faucet
# at https://faucet.solana.com (it has a separate, more generous limit).
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

CLUSTER="https://api.devnet.solana.com"
PER_WALLET_SOL="${PER_WALLET_SOL:-4}"

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=("$(solana address)")
  echo "No addresses given; using the CLI wallet: ${targets[0]}"
fi

for addr in "${targets[@]}"; do
  echo "=== $addr ==="
  for _ in $(seq 1 "$PER_WALLET_SOL"); do
    solana airdrop 1 "$addr" --url "$CLUSTER" || echo "  (airdrop refused; continuing)"
  done
  echo "balance: $(solana balance "$addr" --url "$CLUSTER")"
done
