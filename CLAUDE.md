# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Challenge constraints (non-negotiable)

This project is a submission for a challenge: remove the need for trust from
a financial transaction using a Solana program. Every change must preserve:

- No admin keys, fee accounts, pause switches, or any instruction that lets
  anyone (organizer, developer, third party) redirect funds or change goal,
  deadline, mint, or recipient after the first contribution.
- withdraw is permissionless and can only send funds to the stored recipient.
- refund is callable by the contributor without anyone's permission.
- All app data lives on Solana. No backend, no database; the frontend is a
  static site reading via RPC.
- The program will be made immutable (upgrade authority removed) before
  submission.
- Docs must not invent statistics or fees; use [TODO: ...] placeholders.
  If a requested change would violate any of these, stop and explain the
  conflict instead of implementing it.

## What this is

"Chip In": a trustless group fundraiser on Solana in USDC (devnet only, hackathon project). Contributions sit in each campaign's vault (its associated USDC token account, owned by the campaign PDA). Once the goal is reached anyone can trigger the payout, which only ever goes to the stored recipient; if the goal is missed by the deadline or the organiser cancels first, each contributor refunds exactly their own amount. The React frontend is a static site that talks to the chain directly.

- `program/` — Anchor workspace (Rust). All rule enforcement lives here.
- `app/` — Vite + React 19 + TypeScript frontend, Solana wallet adapter (Phantom, Solflare; Wallet Standard wallets such as Backpack are detected automatically).
- `scripts/` — bash helpers: devnet deploy, airdrop, seeding a local validator, making the program immutable.

Program ID `DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7` is the `declare_id!`. Its deploy keypair (`program/target/deploy/fundraiser-keypair.json`) is gitignored and may be missing locally — `anchor build` then generates a different one; don't deploy with it (`deploy-devnet.sh` refuses). Nothing is deployed to devnet yet.

## Commands

Toolchain: Agave `solana` CLI, Anchor 1.2.0, Rust per `program/rust-toolchain.toml`; `source scripts/env.sh` in every shell. On Windows everything Solana runs in WSL, and the repo's `scripts/*.sh` may be CRLF there.

Program (`program/`):

```bash
anchor build                          # localnet build: accepts the test USDC mint
anchor build -- --features devnet     # devnet USDC; --features mainnet for real USDC
npm test                              # LiteSVM suite, no validator, ~seconds
npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/litesvm/**/*.test.ts' -g "double refund"   # one test
```

Tests run in-process on LiteSVM 1.x via `tests/litesvm/provider.ts` (a small Anchor provider bridging web3.js v1 to LiteSVM; litesvm 0.3 / anchor-litesvm cannot load the SBPF v3 programs Agave 4.x builds). Deadlines are passed with `h.warp(seconds)`; `fixtures.ts` builds every instruction call. Run `anchor build` first — tests load `target/deploy/fundraiser.so` and `target/idl/fundraiser.json`. On Windows run them inside WSL: `program/node_modules` holds LiteSVM's native binary for the platform it was installed on (linux-x64 here), so `npm test` from Windows fails to load it.

Frontend (`app/`):

```bash
npm run dev                                          # http://localhost:5173, devnet
VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev  # against a local validator
npm run build                                        # tsc -b && vite build
npm run lint                                         # oxlint
```

Local end-to-end, from the repo root, with a localnet build (no features — the seed script refuses any other):

```bash
solana-test-validator --ledger program/test-ledger --reset --quiet   --bpf-program DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7 program/target/deploy/fundraiser.so
./scripts/seed-local.sh                                      # test USDC mint + campaigns in every state
cd app && VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
```

`--bpf-program` loads the build at the declared address, so the missing deploy keypair doesn't matter locally. `--reset` wipes everything, so re-seed after every validator restart. The app's wallet bar has "Get test SOL" and, on localnet, "Get test USDC".

Devnet: fund the deploy wallet (`./scripts/airdrop.sh`), then `./scripts/deploy-devnet.sh`. **Never run `scripts/make-immutable.sh`** without explicit instruction — it permanently discards the upgrade authority.

## Architecture

### On-chain program (`program/programs/fundraiser/src/`)

Seven instructions in `lib.rs`, each delegating to `instructions/<name>.rs` (`handle_<name>`): `create_campaign`, `update_recipient`, `contribute`, `withdraw`, `refund`, `cancel`, `close_campaign`. Every state change emits an event (`events.rs`).

- **`Campaign`** PDA, seeds `["campaign", organizer, campaign_id as u64 LE]`. Holds the rules and a stored `status` (Active → Succeeded on the contribution that reaches the goal → Withdrawn; or Active → Cancelled). Fixed-size fields come first so they sit at fixed memcmp offsets the app relies on: organizer 8, recipient 40, mint 72, campaign_id 104, status 112 — keep that order.
- **Vault**: the campaign's associated token account for `mint`; authority is the campaign PDA, so payouts are `transfer_checked` CPIs signed with the campaign seeds. `withdraw` pays exactly `total_raised` (never the vault balance), so tokens sent to the vault outside `contribute` are never paid out.
- **`Contribution`** PDA, seeds `["contribution", campaign, contributor]`, is the refund receipt; `refund` closes it (`close = contributor`), which prevents a double refund. `campaign` must stay the first field (memcmp offset 8); `contributor` is at 40.
- **`USDC_MINT`** (`constants.rs`) is chosen by cargo feature: `mainnet`, `devnet`, or neither (localnet test mint from a public seed). Every token account is pinned with Anchor constraints (`address`/`has_one` for the mint, `token::`/`associated_token::` for sources, vault and destinations).

Rules enforced: `contribute` only while Active and before the deadline, never past the goal (`ExceedsGoal`, so the payout always equals the goal), and `expected_recipient` must match (a recipient change can never catch a contributor); `withdraw` is permissionless once Succeeded, destination pinned to the stored recipient, and must carry the campaign's stored Solana Pay `reference` account when it has one; `refund` by the contributor once Cancelled or (Active and past the deadline); `cancel` by the organiser only while Active; `update_recipient` by the organiser only while Active and nothing raised (it sets recipient, `reference` and `memo` together); `close_campaign` only when settled, and it also closes the (empty) vault. Time always comes from `Clock::get()`, all arithmetic is checked. Add new errors at the **end** of `error.rs`: Anchor numbers them by position (6000 + index), so inserting one renumbers every later code — the app's `idl/fundraiser_errors.ts` and any recorded codes would silently shift. A campaign with every field at its maximum must still fit in one transaction (1232 bytes) with headroom — `validation.test.ts` enforces it; mind this when adding accounts or fields. Keep the README's "Who can call what" table in sync if rules change.

### Frontend (`app/src/`)

- `idl/fundraiser.json`, `idl/fundraiser.ts` and `idl/fundraiser_errors.ts` are generated from `program/target/` (`deploy-devnet.sh` copies them). After changing the program, re-sync all three. The app uses `@coral-xyz/anchor` 0.32 against the Anchor 1.2 IDL.
- `lib/program.ts` — `useProgram()` (works read-only without a wallet), PDA helpers, `USDC_MINT` (read from the IDL), `tokenAccountOf` / `vaultOf`.
- `lib/indexer/` — every chain read goes through the `CampaignIndex` interface; `RpcCampaignIndex` uses getProgramAccounts + memcmp. Swap the implementation in `useCampaignIndex()` to add an indexing service.
- `lib/campaign.ts` — campaign model; `campaignStatus()` maps the stored status (plus the clock for "Active past deadline" = failed) to open / succeeded / failed / cancelled / withdrawn.
- `lib/actions.ts` — `buildContributeTransaction`, the reusable builder (and the extension point for a Solana Pay transaction-request endpoint, which this project deliberately does not have).
- `lib/format.ts` — exact USDC parsing/formatting (string/bigint arithmetic, 6 decimals); SOL formatting only for fees and deposits.
- `lib/fees.ts` — network fee quotes and account deposits (sizes mirror `state.rs`; update when structs change). `components/ReviewPanel.tsx` shows every action's costs before the wallet signs; cost lines carry an asset (`usdc` | `sol`).
- `lib/send.ts` — signs/sends, classifies `success` / `failed-on-chain` / `never-sent`; extra signers (invite key, local test-USDC mint) sign after the wallet. The "Try to pay out early (demo)" button uses `skipPreflight: true` so the rejected transaction lands on chain.
- `lib/errors.ts` — program errors (via the IDL) and token-program failures in plain language. `lib/explain.ts` — "What can happen now" and the permissions table; each sentence corresponds to a check in the program.
- `lib/solanaPay.ts` — parses Solana Pay transfer links in the recipient field; references are remembered per browser for the payout. `lib/walletLinks.ts` — QR targets (plain link, Phantom/Solflare browse deeplinks).
- `lib/testUsdc.ts` — localnet-only "Get test USDC" (the test mint's authority is a public-seed key).
- `lib/cluster.ts` — devnet by default; `VITE_RPC_ENDPOINT` is a local-dev override only. There is intentionally no mainnet option.
- `vite.config.ts` uses `vite-plugin-node-polyfills` (Buffer, process, crypto, …) — required for anchor/web3.js in the browser.

### UI language

Target users are non-crypto people. Campaign money is shown in USDC (`formatUsdc`), fees and deposits in SOL, never base units or lamports. Avoid jargon like "PDA"; use plain action names ("Contribute", "Send the money to the recipient", "Get my money back"). Technical details appear only as Explorer links serving as proof.
