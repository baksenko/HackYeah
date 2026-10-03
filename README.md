# Chip In — a group fundraiser with no middleman

A group of friends pools money for a shared goal. The money sits in a Solana
program that nobody controls. If the goal is reached by the deadline, only the
person it was collected for can take it. If it isn't, every contributor takes
back exactly what they put in. Nobody — not the organiser, not us — can change
those rules once a campaign exists.

Built for the Superteam Poland "Finance Without Intermediaries" challenge.
Devnet only. No real money.

- **Program ID (devnet):** `DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7`
- **Anchor** 1.2.0 · **solana-cli** 4.1.2 (Agave) · **rustc** 1.99.0

> **Deployment status.** The program builds, passes its full test suite, and the
> frontend has been verified end to end against a local validator. The devnet
> deploy itself is still pending: the devnet faucet is rate-limiting this IP and
> the deploy needs ~2.05 SOL of devnet SOL that we could not obtain. See
> [Deploying to devnet](#deploying-to-devnet). The program ID above is fixed by
> the keypair in `program/target/deploy/fundraiser-keypair.json` and will be the
> address once deployed.

---

## The relationship we redesigned

**Today.** Someone says "let's all chip in for Anna's leaving gift". One person
collects the money — into their own bank account, or through a platform like
zrzutka.pl. From that moment everyone else is trusting them:

- to not spend it before the gift is bought,
- to actually buy the gift,
- to give the money back if not enough people join in,
- and to still be reachable in three weeks' time.

**The intermediary** is whoever holds the pot: the organiser, or the platform.
Their *promise* is the only thing standing between the contributors and their
money. Everything else — the deadline, the target, "you'll get it back if we
don't make it" — is a social convention, not a rule anything enforces.

**Here.** The pot is a program-owned account. There is no key that can move the
money, because no human holds that account. The money can leave it in exactly
two ways, both written into the program:

| | |
|---|---|
| Goal reached by the deadline | Only the recipient named at creation can withdraw |
| Goal missed | Each contributor can reclaim their exact contribution |

The organiser is reduced to the person who filled in the form. They pay a tiny
rent deposit to create the campaign and have no power over the money at all —
not even if they also happen to be the recipient, since even then the deadline
and goal still bind them.

### Target user

Groups of friends, students, flatmates and small teams pooling money for a
gift, a trip or a shared purchase. Mostly people with no interest in crypto.
The UI never shows a lamport, never says "PDA", and names the actions in plain
language: *Contribute*, *Get my money back*. Technical details appear only
where they serve as proof — the Solana Explorer links.

---

## Where the intermediary disappears

Every rule is a `require!` in the on-chain program. The frontend can offer any
button it likes; the program is what decides.

### `withdraw` — only the recipient, only on success, only once
`program/programs/fundraiser/src/instructions/withdraw.rs`

```rust
// in the Accounts struct — the signer must BE the recipient
constraint = campaign.recipient == recipient.key() @ FundraiserError::NotRecipient,

// in handle_withdraw
require!(!campaign.withdrawn,                    FundraiserError::AlreadyWithdrawn);
require!(now >= campaign.deadline,               FundraiserError::DeadlineNotReached);
require!(campaign.total_raised >= campaign.goal, FundraiserError::GoalNotReached);
```

`campaign.recipient` is written once in `create_campaign` and there is no
instruction anywhere in the program that writes to it again. The money cannot
be redirected, and the organiser cannot withdraw unless they *are* the
recipient.

### `refund` — each contributor, their own money, only on failure
`program/programs/fundraiser/src/instructions/refund.rs`

```rust
require!(now >= campaign.deadline,              FundraiserError::DeadlineNotReached);
require!(campaign.total_raised < campaign.goal, FundraiserError::GoalReached);
```

The amount paid out is `contribution.amount` — that contributor's own number,
not a share of whatever is left. The `Contribution` PDA is seeded with
`["contribution", campaign, contributor]`, so a contributor can only ever reach
their own receipt. `close = contributor` deletes that receipt as it pays out,
which is what makes a second refund impossible: the account the instruction
needs no longer exists.

### `contribute` — anyone, but only while it is open
`program/programs/fundraiser/src/instructions/contribute.rs`

```rust
require!(amount > 0,                     FundraiserError::InvalidAmount);
require!(now < ctx.accounts.campaign.deadline, FundraiserError::DeadlinePassed);
```

The SOL moves by System Program CPI into the `Campaign` PDA itself. From that
moment it is held by a program-owned account, so no private key in the world
can move it except through `withdraw` or `refund`.

### The escrow is the campaign account
The `Campaign` PDA holds the lamports directly. Its balance is always

```
rent-exempt reserve + (total_raised − total_refunded)
```

Both payout paths debit lamports straight from it and both check that the
rent-exempt reserve survives (`InsufficientCampaignBalance`), so the account
that records the rules can never be drained out of existence.

### What is *not* in the program
There is no admin key, no platform fee, no pause switch, no "edit campaign",
and no partial or milestone withdrawal. These are absent by construction — if
an instruction does not exist, nobody can call it.

---

## Who can call what

| Instruction | Who may sign | Conditions enforced on chain | Rejects with |
|---|---|---|---|
| `create_campaign` | Anyone (becomes the organiser) | `goal > 0`, `deadline > now`, title ≤ 64 bytes | `InvalidGoal`, `InvalidDeadline`, `TitleTooLong` |
| `contribute` | Anyone | `now < deadline`, `amount > 0` | `DeadlinePassed`, `InvalidAmount` |
| `withdraw` | **Only `campaign.recipient`** | `now ≥ deadline`, `total_raised ≥ goal`, `!withdrawn` | `NotRecipient`, `DeadlineNotReached`, `GoalNotReached`, `AlreadyWithdrawn` |
| `refund` | **Only the contributor of that `Contribution`** | `now ≥ deadline`, `total_raised < goal` | `DeadlineNotReached`, `GoalReached` |
| `close_campaign` | **Only `campaign.organizer`** | `withdrawn`, or goal missed and `total_refunded == total_raised` | `CampaignNotSettled` |

`close_campaign` is housekeeping: it returns the organiser's own rent deposit
once nothing is left to settle. It is unreachable while any contributor is
still owed a refund, so it can never touch contributor money.

Time is always `Clock::get()?.unix_timestamp` — the cluster's clock, not a
timestamp passed in by a caller. All arithmetic is checked.

---

## What if a party disappears?

**The organiser vanishes.** Nothing changes. They hold no power to begin with:
they cannot withdraw (unless they are also the recipient, and then only under
the same rules as anyone), cannot cancel, cannot edit. Contributions and
refunds carry on working without them. The only thing lost is their own rent
deposit, which `close_campaign` would have returned.

**A contributor vanishes.** Their refund waits for them indefinitely. There is
no claim deadline and no expiry — their `Contribution` account stays on chain
until they sign for it. Nobody can claim it on their behalf or sweep it.

**The recipient never withdraws after a successful campaign.** The funds stay
locked in the PDA forever. This is a real limitation and we are not going to
pretend otherwise: contributors cannot refund (the goal was met) and nobody
else can withdraw (they are not the recipient), so the money is stuck. The fix
is a claim window — see [Next steps](#known-limitations-and-next-steps). We
chose not to add one for the MVP because it introduces a second deadline and a
second set of rules to explain, and we would rather ship a small set of rules
that are completely honest than a larger set we only half-tested.

---

## Can the authors change anything?

**Right now, yes — and you should know exactly how.** The program is deployed
as an upgradeable program, so whoever holds the upgrade authority (the deploy
wallet, `HjfSNzEaFFWMoijgQN8jhMye4yfSoAbgSfBshHroRB7K`) can replace its code
with a different program at the same address. That would mean replacing the
rules this entire project rests on. No amount of careful `require!` statements
protects you from a changed program.

What the authority holder **cannot** do is reach into existing campaigns with
the current code. There is no admin instruction, no backdoor, no privileged
key in the program itself. The only lever is a full code replacement.

**To remove even that lever**, discard the upgrade authority:

```bash
solana program set-upgrade-authority <PROGRAM_ID> --final
# or, with the guard rails:
./scripts/make-immutable.sh
```

After that the program can never be upgraded by anyone, including us. It is
irreversible — no bug fix, no recovery, ever. `scripts/make-immutable.sh` is
provided and documented but **has not been run**: for a hackathon demo,
staying upgradeable is the honest trade-off, and claiming otherwise would be
worse than admitting it. Verify the current state yourself:

```bash
solana program show DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7 --url devnet
```

---

## Why blockchain and not a database?

A database would model this perfectly well. The problem is not modelling — it
is **who runs the thing that enforces the model**.

With a server and a database, the rules are real only while the operator wants
them to be. The operator can run an `UPDATE`, ship a patch that skips the
deadline check, move the pooled money out of the bank account the database is
merely *describing*, get acquired, or shut down. The contributors cannot check
any of this, and if they are wrong about the operator's honesty they find out
only when the money is gone. Auditability does not fix it either: logs are
written by the same party you are trusting.

Three properties are doing the work here, and none of them come from a
database:

1. **The money and the rules are the same object.** `Campaign` is not a record
   describing a balance held elsewhere; it *holds* the lamports. There is no
   step where the rules say one thing and the bank account does another.
2. **Nobody can execute what isn't written.** A database's constraints are
   enforced by a process an operator controls. The program's constraints are
   enforced by every validator. "Please let me withdraw early" is not a request
   anyone can grant.
3. **Anyone can verify it, now and later.** Contributors can read the deployed
   bytecode, the campaign's state and every transaction without asking us for
   access. And with `--final`, the authors can provably remove themselves.

The honest summary: this is worth doing when the people pooling money do not
all trust the same person, and that person would otherwise have to be trusted
with everything. For four flatmates who trust each other, a shared spreadsheet
is fine.

---

## What lives where

```
program/                                  Anchor workspace — all rule enforcement
  programs/fundraiser/src/
    lib.rs                                the five instructions
    state.rs                              Campaign and Contribution accounts
    error.rs                              named errors (DeadlineNotReached, …)
    constants.rs                          PDA seeds, max title length
    instructions/
      create_campaign.rs                  writes the rules once, immutably
      contribute.rs                       deadline + amount checks, SOL into the PDA
      withdraw.rs                         recipient + deadline + goal + once
      refund.rs                           deadline + goal-missed, closes the receipt
      close_campaign.rs                   organiser reclaims rent when settled
  tests/fundraiser.ts                     both outcomes + six rejections
  target/idl/fundraiser.json              generated IDL (copied into the app)

app/                                      frontend — no backend, no database
  src/lib/program.ts                      Anchor client + PDA derivation
  src/lib/campaign.ts                     reads chain state, derives Open/Succeeded/Failed/Withdrawn
  src/lib/send.ts                         signs, sends, and reports what the chain did
  src/lib/errors.ts                       maps program errors to plain language
  src/lib/explain.ts                      the "What can happen now" wording
  src/lib/useChainClock.ts                uses the cluster's clock, not the browser's
  src/pages/HomePage.tsx                  campaign list via getProgramAccounts
  src/pages/CreateCampaignPage.tsx        create form
  src/pages/CampaignPage.tsx              actions, contributors, early-withdraw demo

scripts/
  env.sh                                  puts the toolchain on PATH
  airdrop.sh                              devnet SOL for demo wallets
  deploy-devnet.sh                        build + deploy + sync IDL into the app
  make-immutable.sh                       discard the upgrade authority (NOT run)
  seed-local.sh / .ts                     fills a local validator with all four states
```

**There is no server and no database.** The frontend reads campaigns with
`getProgramAccounts` filtered by the `Campaign` discriminator, and a campaign's
contributors with one `memcmp` at offset 8 against `Contribution.campaign` —
which is why that field is first in the struct. Every write is a transaction
signed by the user's own wallet.

---

## Running it

### Prerequisites

```bash
# Rust, Solana (Agave) CLI and Anchor
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest && avm use latest

source scripts/env.sh   # in every shell afterwards
```

### Tests

Anchor 1.2 defaults to `surfpool` as its local validator; this workspace uses
the `solana-test-validator` that ships with Agave, so start one yourself:

```bash
# terminal 1
solana-test-validator --ledger program/test-ledger --reset --quiet

# terminal 2
cd program && npm install && anchor test --skip-local-validator
```

Deadlines in the suite are ~8 seconds out and the tests really wait for them,
so a full run takes about a minute.

```
✔ success path: two contributions reach the goal, then the recipient withdraws
✔ failure path: the goal is missed, so the contributor reclaims exactly what they paid
✔ rejects withdraw before the deadline
✔ rejects withdraw by anyone who is not the recipient
✔ rejects withdraw when the goal was missed
✔ rejects refund when the goal was reached
✔ rejects a second refund
✔ rejects contribute after the deadline
8 passing
```

### Deploying to devnet

Deploying costs about **2.05 SOL** of devnet SOL (rent for a ~199 KB program).

```bash
solana config set --url devnet
./scripts/airdrop.sh                 # or https://faucet.solana.com if rate-limited
./scripts/deploy-devnet.sh
```

The faucet caps airdrops at 2 SOL and rate-limits per IP; `faucet.solana.com`
has a separate, more generous limit. `deploy-devnet.sh` copies the freshly
generated IDL and types into `app/src/idl/`, so the app always talks to exactly
what was deployed.

### The frontend

```bash
cd app && npm install && npm run dev     # http://localhost:5173, devnet
```

Connect Phantom or Solflare, set to **Devnet** in the wallet's own settings.
`./scripts/airdrop.sh <YOUR_WALLET_ADDRESS>` funds it.

To develop against a local validator instead:

```bash
VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
```

That override exists only for local development. There is no mainnet option
anywhere in the app.

---

## Demo walkthrough

Three devnet wallets: **A** (organiser and recipient), **B** and **C**
(contributors). Fund all three with `./scripts/airdrop.sh <A> <B> <C>`.

**Campaign 1 — it succeeds**

1. **A** creates "Leaving gift for Anna": goal **1 SOL**, deadline **2 minutes**.
2. **B** contributes **0.6 SOL**, **C** contributes **0.5 SOL**. The bar passes
   100% and both appear under "Who chipped in".
3. **A** clicks **"Try to withdraw early (demo)"** — *this is the moment the
   point is made*. The transaction is sent with `skipPreflight: true`, so it is
   really submitted to devnet and really rejected by the program. The UI shows
   `DeadlineNotReached` and links to the **failed transaction** on Solana
   Explorer. The web page did not stop A. The program did.
4. After the deadline the badge flips to **Succeeded**. **A** clicks
   **Withdraw** and receives 1.1 SOL. Explorer link shown.

**Campaign 2 — it fails**

5. **A** creates "Ski trip deposit": goal **5 SOL**, deadline **2 minutes**.
6. **B** contributes **0.3 SOL**.
7. After the deadline the badge flips to **Failed**. **A** trying to withdraw
   is rejected with `GoalNotReached`.
8. **B** clicks **"Get my money back"** and receives their 0.3 SOL — plus the
   rent of the closed receipt. Clicking it again fails: the receipt is gone.

Worth pointing out while demoing: at step 3 the *organiser and recipient* is
the one being refused, by a rule they themselves set two minutes earlier and
now cannot undo.

---

## Known limitations and next steps

- **SOL only.** Pooling in **USDC** or another SPL token would remove the
  exchange-rate risk over a week-long campaign, which matters a lot for
  "we need exactly 400 zł". This means token accounts and an ATA for the
  campaign PDA.
- **Funds stick if the recipient never withdraws.** A **claim window** — after
  which an unclaimed successful campaign becomes refundable to its contributors
  — would close the one hole we know about. See
  [What if a party disappears?](#what-if-a-party-disappears).
- **No organiser cancel-and-refund.** If a campaign is created by mistake or
  the gift gets cancelled, everyone must wait for the deadline. An organiser
  `cancel()` that only ever opens refunds (and can never pay out) would be safe
  to add.
- **Sharing is manual.** **Shareable invite links** with a preview of the
  campaign, so joining is one tap rather than copying a base58 address.
- **The program is still upgradeable.** See
  [Can the authors change anything?](#can-the-authors-change-anything).
- **Not audited.** Devnet, test money, a hackathon weekend. Do not put real
  money anywhere near this.
