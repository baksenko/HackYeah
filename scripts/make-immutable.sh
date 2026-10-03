#!/usr/bin/env bash
# DANGER: ONE-WAY AND IRREVERSIBLE.
#
# Until this is run, whoever holds the upgrade authority can replace the
# program's code -- which means they could replace the rules this whole
# project is built on. Running this discards the upgrade authority forever:
# no new version, no bug fix, no recovery. After it, the rules in
# program/programs/fundraiser/src/instructions/ are the only rules there will
# ever be, and not even the authors can change them.
#
# For a hackathon demo, leaving the program upgradeable is the honest choice
# (see "Can the authors change anything?" in the README). Run this only when
# you genuinely want to give up that power.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

PROGRAM_ID="${1:-$(solana address -k program/target/deploy/fundraiser-keypair.json)}"

cat <<MSG
About to make $PROGRAM_ID immutable on devnet.
This CANNOT be undone. The program can never be upgraded again.
MSG
read -r -p 'Type "yes, make it final" to continue: ' confirm
[ "$confirm" = "yes, make it final" ] || { echo "Aborted."; exit 1; }

solana program set-upgrade-authority "$PROGRAM_ID" --final --url https://api.devnet.solana.com
solana program show "$PROGRAM_ID" --url https://api.devnet.solana.com
