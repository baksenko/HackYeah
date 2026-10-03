# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Chip In": a trustless group fundraiser on Solana (devnet only, hackathon project). An Anchor program holds contributions in a PDA; if the goal is met by the deadline only the named recipient can withdraw, otherwise each contributor refunds exactly their own amount. The React frontend talks to the chain directly — **there is no backend and no database**.

- `program/` — Anchor workspace (Rust). All rule enforcement lives here.
- `app/` — Vite + React 19 + TypeScript frontend, Solana wallet adapter (Phantom, Solflare).
- `scripts/` — bash helpers for deploy, airdrop, seeding a local validator, and making the program immutable.

Program ID `DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7` is fixed by `program/target/deploy/fundraiser-keypair.json` (gitignored — don't regenerate it). The devnet deploy is still pending (faucet rate limits), so the app against devnet shows no campaigns until it is deployed.

## Commands

The toolchain (Agave `solana` CLI, Anchor 1.2.0, Rust via `program/rust-toolchain.toml`) is expected under `~/.cargo/bin` and `~/.local/share/solana/...`; run `source scripts/env.sh` in every shell. All scripts are bash.

Frontend (`app/`):
```bash
npm run dev                                          # http://localhost:5173, devnet
VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev  # against a local validator
npm run build                                        # tsc -b && vite build
npm run lint                                         # oxlint
```

Program (`program/`). Anchor 1.2 defaults to `surfpool`; this repo uses `solana-test-validator` instead, so start it yourself and always pass `--skip-local-validator`:
```bash
solana-test-validator --ledger test-ledger --reset --quiet   # terminal 1
anchor build
anchor test --skip-local-validator                           # terminal 2; ~1 min
```
The tests use real ~8 s deadlines and actually sleep, so they're slow by design. To run a single test against an already-deployed local program, call mocha directly with `-g`:
```bash
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  npx ts-mocha -p ./tsconfig.json -t 1000000 tests/fundraiser.ts -g "rejects a second refund"
```

Local end-to-end: start the validator, `solana program deploy --url localhost --program-id program/target/deploy/fundraiser-keypair.json program/target/deploy/fundraiser.so`, then `./scripts/seed-local.sh` (creates campaigns in all four states), then run the app with `VITE_RPC_ENDPOINT`.

Devnet: `./scripts/airdrop.sh [ADDR...]`, then `./scripts/deploy-devnet.sh` (needs ~2.05 SOL). **Never run `scripts/make-immutable.sh`** without explicit instruction — it permanently discards the upgrade authority.

## Architecture

### On-chain program (`program/programs/fundraiser/src/`)
Five instructions in `lib.rs`, each delegating to `instructions/<name>.rs` (`handle_<name>`): `create_campaign`, `contribute`, `withdraw`, `refund`, `close_campaign`. Accounts are in `state.rs`:

- **`Campaign`** PDA, seeds `["campaign", organizer, campaign_id as u64 LE]`. It *is* the escrow: lamports are held directly in it. Invariant: `balance == rent_exempt + (total_raised - total_refunded)`; payouts check that the rent reserve survives (`InsufficientCampaignBalance`).
- **`Contribution`** PDA, seeds `["contribution", campaign, contributor]`. Acts as the refund receipt; `refund` closes it (`close = contributor`), which is what prevents a double refund. `campaign` must remain the **first field** after the discriminator — the frontend lists contributors with a `memcmp` at offset 8.

Design constraints that are deliberate, not omissions: no admin key, no fee, no pause, no edit, no partial withdrawal; `recipient` is written only in `create_campaign`. Time always comes from `Clock::get()`, and all arithmetic is checked. Keep the README's "Who can call what" table in sync if rules change.

### Frontend (`app/src/`)
- `idl/fundraiser.json` + `idl/fundraiser.ts` are **copied from `program/target/`** by `deploy-devnet.sh`. After changing the program, re-sync them (otherwise the app's IDL, PDA layout, and error codes drift). The frontend uses `@coral-xyz/anchor` 0.32 against an Anchor 1.2 program/IDL.
- `lib/program.ts` — `useProgram()` builds the Anchor `Program`; without a connected wallet it uses a read-only throwaway keypair so browsing works. PDA helpers here must mirror the Rust seeds.
- `lib/campaign.ts` — reads via `program.account.*.all()` (getProgramAccounts). Status (`open`/`succeeded`/`failed`/`withdrawn`) is derived from on-chain fields plus the clock and mirrors the program's checks.
- `lib/useChainClock.ts` — UI time comes from the cluster's block time, not the browser clock, so buttons match what the program will accept.
- `lib/send.ts` — signs/sends and classifies outcomes as `success` / `failed-on-chain` / `never-sent`. The "Try to withdraw early (demo)" button uses `skipPreflight: true` deliberately so the rejected transaction lands on chain and can be shown on Explorer.
- `lib/errors.ts` — maps program error codes/log lines (via the IDL) to plain-language messages. `lib/explain.ts` — the "What can happen now" text and permissions table; each sentence corresponds to a `require!` in the program, so update it when rules change.
- `lib/cluster.ts` — devnet by default; `VITE_RPC_ENDPOINT` is a local-dev override only. There is intentionally no mainnet option.
- `vite.config.ts` uses `vite-plugin-node-polyfills` (Buffer, process, crypto, …) — required for anchor/web3.js in the browser.

### UI language
Target users are non-crypto people. User-facing text shows SOL (never lamports — use `lib/format.ts`), avoids jargon like "PDA", and uses plain action names ("Contribute", "Get my money back"). Technical details appear only as Explorer links serving as proof.
