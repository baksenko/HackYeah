# Chip In — group money with no middleman

**Friends pool USDC for a trip, a gift or a shared order. The money is held by
a Solana program that nobody controls. Goal reached: it goes to the recipient —
for a shop order, in the very transaction that completes it. Goal missed or
cancelled: everyone takes back exactly what they put in. Nobody — not the
organiser, not us — can bend these rules once a campaign exists.**

Built for the Superteam Poland challenge **"Finance Without Intermediaries"**.
Devnet and local only — no real money.

| | |
|---|---|
| Program (devnet) | [`HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw`](https://explorer.solana.com/address/HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw?cluster=devnet) |
| Stack | Anchor 1.2 (Rust) · React + TypeScript · Solana wallet adapter · USDC (SPL) |
| Backend / database | **None.** A static site talks to the chain directly. |
| Tests | 68 passing (LiteSVM, `program/tests/litesvm/`) |
| Live demo | [TODO: public URL of the hosted app] |
| Video | [TODO: demo video link] |

<!-- 📸 SCREENSHOT 01 — landing page (http://localhost:5173/): hero + "how it works" steps. Save as docs/screenshots/01-home.png -->
![Chip In landing page](docs/screenshots/01-home.png)

---

## For the jury: how this project meets each criterion

| Criterion | Weight | Where to look | In one line |
|---|---|---|---|
| Relevance to the challenge | 30% | [Relevance](#1-relevance-to-the-challenge-30) · [Where the intermediary disappears](#where-the-intermediary-disappears) | Every rule — who gets paid, when, refunds, who may join — is a check in the on-chain program. No admin key, no fee, no server. |
| Completeness and functionality | 25% | [Completeness](#2-completeness-and-functionality-25) · [Demo walkthrough](#demo-walkthrough) | 7 instructions, 68 tests, a full web app (create, contribute, pay out, refund, cancel, share, search, leaderboard, shop checkout). |
| Idea and choice of problem | 20% | [The problem](#3-idea-and-choice-of-problem-20) | Group collections are an everyday, trust-heavy money relationship that today runs through one person's bank account. |
| Implementation potential | 15% | [Path to production](#4-implementation-potential-15) | USDC, Solana Pay for shops, mainnet build flag, static hosting, an indexer interface — and an honest list of what is missing. |
| Originality | 10% | [What is new here](#5-originality-10) | A shop order is paid **atomically by the contribution that completes it**; invite-only campaigns enforced on chain; buttons that deliberately send doomed transactions so you can watch the program refuse them. |

> **How to verify a claim quickly:** every rule below names the file and the
> error it produces. Run `cd program && npm install && anchor build && npm test`
> (about one second, no validator) to see all 68 tests pass.

---

## 1. Relevance to the challenge (30%)

### The relationship we redesigned

**Today.** Someone says "let's all chip in for Anna's leaving gift". One person
collects the money — into their own bank account, or through a platform like
zrzutka.pl. From that moment everyone else is trusting them:

- to not spend it before the gift is bought,
- to actually buy the gift,
- to give the money back if not enough people join in,
- and to still be reachable in three weeks' time.

**The intermediary** is whoever holds the pot: the organiser, or the platform.
Their *promise* is the only thing standing between the contributors and their
money. The deadline, the target, "you'll get it back if we don't make it" — all
social conventions that nothing enforces.

**With Chip In** the pot is the campaign's own USDC account (its *vault*),
whose only authority is the program. No human key can move it. Money leaves it
in exactly two ways, both written into the program:

| Outcome | What the program allows |
|---|---|
| Goal reached | Paid to the stored recipient — immediately, by the contribution that completes the goal, or later by **anyone** pressing "pay out". It can go nowhere else. |
| Goal missed by the deadline, or campaign cancelled | Each contributor takes back their exact contribution. Nobody else can touch it. |

The organiser is reduced to the person who filled in the form. They can fix a
mistyped recipient *before anyone contributes* and call the campaign off
*before the goal is reached* — which only ever opens refunds. They can never
take, redirect or freeze anyone's money.

<!-- 📸 SCREENSHOT 02 — a campaign page (open campaign): progress, countdown, the "What can happen now" panel and "Who is allowed to do what" table. Save as docs/screenshots/02-campaign-what-can-happen.png -->
![Campaign page explaining, from on-chain state, who can do what](docs/screenshots/02-campaign-what-can-happen.png)

### Where the intermediary disappears

Every rule is a check in `program/programs/fundraiser/src/`. The frontend can
offer any button it likes; the program decides.

**Payout — only to the recipient, only when the goal is reached, only once.**
`instructions/withdraw.rs`, `payout.rs`, `instructions/contribute.rs`

```rust
has_one = recipient @ FundraiserError::NotRecipient,      // destination pinned to the stored recipient
associated_token::authority = recipient,                  // ...and to their own USDC account
CampaignStatus::Active    => return err!(FundraiserError::GoalNotReached),
CampaignStatus::Withdrawn => return err!(FundraiserError::AlreadyWithdrawn),
CampaignStatus::Cancelled => return err!(FundraiserError::CampaignCancelled),
```

The payout is **permissionless**: whoever triggers it pays the fee, and exactly
what was raised goes to the recipient — never to the caller. Contributions are
capped at the goal (`ExceedsGoal`), so the payout always equals the goal.

**Refund — each contributor, their own money, only on failure.**
`instructions/refund.rs`

```rust
CampaignStatus::Cancelled => {}                                        // refunds open at once
CampaignStatus::Active    => require!(now >= campaign.deadline, DeadlineNotReached),
CampaignStatus::Succeeded | CampaignStatus::Withdrawn => return err!(GoalReached),
```

The refund is the contributor's own receipt (`Contribution` at
`["contribution", campaign, contributor]`), not a share of what is left.
`close = contributor` deletes the receipt as it pays out, which makes a second
refund impossible. Refunds need nobody's permission and never expire.

**Contribute — anyone, while open, to the recipient they saw.**
`instructions/contribute.rs`

```rust
require!(campaign.status == CampaignStatus::Active, FundraiserError::CampaignNotActive);
require!(now < campaign.deadline,                   FundraiserError::DeadlinePassed);
require_keys_eq!(campaign.recipient, expected_recipient, FundraiserError::RecipientChanged);
```

If the organiser changed the recipient after the contributor looked, the
contribution is refused — a recipient change can never catch anyone.

**Private campaigns — only invite-link holders can join.**

```rust
if let Some(expected) = ctx.accounts.campaign.invite {
    let invite = ctx.accounts.invite.as_ref().ok_or(FundraiserError::InviteRequired)?;
    require_keys_eq!(invite.key(), expected, FundraiserError::InvalidInvite);
}
```

A private campaign stores an invite public key; its secret travels only in the
share link's `#fragment` (never sent to any server) and QR code. Contributions
without that key's signature are refused by the program, not hidden by the page.

**What is *not* in the program.** No admin key, no platform fee, no pause, no
"edit campaign", no partial payout, no way to change goal, deadline or token —
ever. An earlier version had a KYC verifier key deciding who could open public
campaigns; we removed it as a privileged key. `no-admin-keys.test.ts` checks
that no privileged signer remains in the interface.

### Who can call what

| Instruction | Who may sign | Conditions enforced on chain | Rejects with |
|---|---|---|---|
| `create_campaign` | Anyone (becomes the organiser) | USDC mint only; `goal > 0`; `deadline > now`; title ≤ 64 B; ≤ 5 tags; description ≤ 300 B; `https://` image link ≤ 200 B; optional Solana Pay reference + memo; optional invite key → private | `WrongMint`, `InvalidGoal`, `InvalidDeadline`, `InvalidRecipient`, `TitleTooLong`, `TooManyTags`, `DescriptionTooLong`, `ImageUrlTooLong`, `InvalidImageUrl`, `MemoTooLong` |
| `contribute` | Anyone (public) · invite holders only (private) | Active; before deadline; `0 < amount ≤ goal − raised`; recipient unchanged; nickname ≤ 32 B. **The contribution reaching the goal pays the recipient in the same transaction** — mandatory for shop orders | `CampaignNotActive`, `DeadlinePassed`, `InvalidAmount`, `ExceedsGoal`, `RecipientChanged`, `NicknameTooLong`, `InviteRequired`, `InvalidInvite`, `WrongMint`, `PayoutAccountsRequired`, `NotRecipient`, `WrongRecipientAccount`, `ReferenceRequired`, `WrongReference` |
| `withdraw` | **Anyone** — pays only `campaign.recipient` | Succeeded; once; carries the shop's reference if set. A fallback when the completing contribution did not pay out | `GoalNotReached`, `AlreadyWithdrawn`, `CampaignCancelled`, `NotRecipient`, `ReferenceRequired`, `WrongReference` |
| `refund` | **Only the contributor of that receipt** | Cancelled, or deadline passed with goal missed | `DeadlineNotReached`, `GoalReached` |
| `cancel` | **Only the organiser** | Active (goal not reached) — opens refunds, moves no money | `NotOrganizer`, `GoalReached`, `CampaignCancelled` |
| `update_recipient` | **Only the organiser** | Active and nothing raised yet | `NotOrganizer`, `RecipientLocked`, `CampaignNotActive`, `InvalidRecipient`, `MemoTooLong` |
| `close_campaign` | **Only the organiser** | Paid out, or every refund taken; vault empty | `CampaignNotSettled`, `NotOrganizer` |

Time always comes from `Clock::get()` (the cluster's clock), all arithmetic is
checked, and every state change emits an event (`CampaignCreated`,
`RecipientUpdated`, `Contributed`, `Withdrawn`, `Refunded`, `Cancelled`).

### What if a party disappears?

- **The organiser vanishes** — nothing changes. They never had power over the
  money; contributions, payout and refunds all work without them.
- **The recipient vanishes** — the payout still happens (anyone can trigger
  it) and lands in the recipient's account, waiting for them.
- **A contributor vanishes** — their refund waits for them indefinitely. No
  expiry, and nobody can claim it on their behalf.

### Can the authors change anything?

**While the program is upgradeable, yes — and we say so.** Whoever holds the
upgrade authority can replace the program's code at the same address, which
would replace the rules. What they **cannot** do is reach into campaigns with
the current code: there is no admin instruction and no privileged key.

To remove even that lever, the upgrade authority is discarded for good:

```bash
./scripts/make-immutable.sh     # = solana program set-upgrade-authority <PROGRAM_ID> --final
```

After that nobody, including us, can ever change the program. **This has not
been done yet** [TODO: run before submission, or state the decision]. Check the
current state yourself:
`solana program show HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw --url devnet`.

### Why blockchain and not a database?

A database could model this perfectly well. The problem is **who runs the thing
that enforces the model**. With a server, the rules hold only while the operator
wants them to: an `UPDATE`, a patch that skips the deadline check, an
acquisition or a shutdown — and the contributors find out only when the money is
gone. Here:

1. **The money and the rules sit together.** The vault holds the USDC and only
   the program can move it, under the rules stored next to it.
2. **Nobody can execute what isn't written.** "Let me take the money early" is
   not a request anyone can grant.
3. **Anyone can verify it** — the bytecode, every campaign and every
   transaction — without asking us.

For four flatmates who trust each other, a spreadsheet is fine. Chip In is for
when the people pooling money do not all trust the same person.

---

## 2. Completeness and functionality (25%)

### What works

| Area | Status |
|---|---|
| On-chain program: 7 instructions, USDC vault, stored status, events | ✅ Built, 68 tests passing |
| Create campaigns: public (crowdfunding) or private (invite-only), tags, description, photo link | ✅ |
| Contribute with a cost review before signing; nicknames; contributions capped at the goal | ✅ |
| **Instant payout:** the contribution that completes the goal pays the recipient in the same transaction | ✅ In the program and app, tested, verified on a local validator — see the deployment note below |
| Permissionless payout button as a fallback; refunds; organiser cancel | ✅ |
| Shop checkout from a Solana Pay link, with order reference and memo on the payout; demo shop that confirms the payment by itself | ✅ |
| Sharing: link, QR code (opens in browser, Phantom or Solflare), native share | ✅ |
| Campaigns page: text search, tags, public/private tabs, status, sort (all in the URL) | ✅ |
| Leaderboard of contributors, per campaign and global | ✅ |
| `.sol` names next to addresses (Solana Name Service) | ✅ Built; live lookup not verified — see [Limitations](#known-limitations-and-next-steps) |
| "Prove it" buttons that send transactions the program must refuse | ✅ |

> **Deployment status.** The program was deployed to devnet on 2026-10-04 at
> the address above, built for Circle's devnet USDC. On devnet so far: a
> campaign was created through the app and an early payout was refused on
> chain (`GoalNotReached`). The **instant payout** was added after that
> deployment and is verified on a local validator (one 642-byte transaction
> completed a 42 USDC shop order, paid the shop and was found by its order
> reference). [TODO: redeploy the current build to devnet and run the full
> flow with devnet USDC.]

### Demo walkthrough

Three wallets: **A** organises, **B** and **C** contribute. On devnet fund them
with SOL ([faucet.solana.com](https://faucet.solana.com)) and devnet USDC
([faucet.circle.com](https://faucet.circle.com)); locally use the app's *Get
test SOL* / *Get test USDC*.

**Campaign 1 — the program refuses an early payout, then pays out on its own**

1. **A** creates "Leaving gift for Anna": goal **50 USDC**.
2. **B** contributes **20 USDC**. Before signing, the review shows exactly
   where the money goes and what it costs.
3. **C** clicks **"Try to pay out early (demo)"** — *this is the moment the
   intermediary disappears*. The transaction is sent with `skipPreflight`, so
   it really lands and is really refused by the program with `GoalNotReached`,
   with a link to the **failed transaction** on Solana Explorer. The web page
   did not stop C. The program did.
4. **C** contributes the remaining **30 USDC**. That same transaction pays all
   50 USDC to the recipient — nobody presses "pay out".

<!-- 📸 SCREENSHOT 03 — the cost review shown before signing a contribution (ideally the one that completes the goal: "it completes the goal"). Save as docs/screenshots/03-review-before-signing.png -->
![Cost review before signing](docs/screenshots/03-review-before-signing.png)

<!-- 📸 SCREENSHOT 04 — the result after "Try to pay out early (demo)": the refusal message with GoalNotReached and the Explorer link. Save as docs/screenshots/04-early-payout-refused.png -->
![The program refuses an early payout](docs/screenshots/04-early-payout-refused.png)

<!-- 📸 SCREENSHOT 05 — that failed transaction on Solana Explorer, showing the program error. Save as docs/screenshots/05-explorer-failed-tx.png -->
![The refused transaction on Solana Explorer](docs/screenshots/05-explorer-failed-tx.png)

**Campaign 2 — called off, everyone refunded**

5. **A** creates "Ski trip deposit", goal **500 USDC**. **B** contributes **30 USDC**.
6. **A** clicks **Cancel campaign** — the review says it only opens refunds.
7. **B** clicks **Get my money back** and receives exactly 30 USDC. A second
   click fails: the receipt is gone.

**Campaign 3 — private, for friends**

8. **A** creates "Trip to New Zealand" as **Private**; the page opens on the
   invite panel with a QR code.
9. **C**, without the link, clicks **"Try to contribute without the invite
   (demo)"** — the program refuses it with `InviteRequired`.
10. **B** opens the invite link, picks the nickname "Kuba" and contributes.

<!-- 📸 SCREENSHOT 06 — the share panel of a private campaign: QR code, copy link, "opens in Phantom/Solflare" options. Save as docs/screenshots/06-share-qr.png -->
![Invite friends with a link or QR code](docs/screenshots/06-share-qr.png)

<!-- 📸 SCREENSHOT 07 — a private campaign opened WITHOUT the invite: the lock message and the "Try to contribute without the invite (demo)" button. Save as docs/screenshots/07-private-locked.png -->
![A private campaign without the invite](docs/screenshots/07-private-locked.png)

**Campaign 4 — a shop order, paid the instant the group completes it**

11. Open **`/demo-shop`** (a pretend café) and click **Pay together with Chip
    In**. The order's amount, shop address and order name arrive locked.
12. The group contributes. The contribution that completes the order pays the
    café in that same transaction, carrying the order reference and memo.
13. The demo shop page — which only watches the chain for its order reference —
    flips to **"Order paid ✓"** by itself.

<!-- 📸 SCREENSHOT 08 — the demo shop showing "Order paid ✓" with the Explorer link. Save as docs/screenshots/08-demo-shop-paid.png -->
![The demo shop confirms the order by itself](docs/screenshots/08-demo-shop-paid.png)

<!-- 📸 SCREENSHOT 09 — the Campaigns page with search, tag chips and public/private tabs. Save as docs/screenshots/09-campaigns-search.png -->
![Search and browse campaigns](docs/screenshots/09-campaigns-search.png)

<!-- 📸 SCREENSHOT 10 — the create form: Private/Public choice, tags, goal, deadline, recipient. Save as docs/screenshots/10-create-campaign.png -->
![Creating a campaign](docs/screenshots/10-create-campaign.png)

<!-- 📸 SCREENSHOT 11 — the leaderboard page. Save as docs/screenshots/11-leaderboard.png -->
![Contributor leaderboard](docs/screenshots/11-leaderboard.png)

### Tests

The suite runs in-process on [LiteSVM](https://github.com/LiteSVM/litesvm): no
validator, and deadlines are tested by moving the clock, so it takes about a
second.

```bash
cd program && npm install && anchor build && npm test     # 68 passing
```

- `security.test.ts` — end-to-end scenarios: happy path with every event; goal
  missed and everyone refunds; double refund fails; cancel then refunds;
  unauthorised cancel / recipient change; payout cannot be redirected; late
  contribution, wrong mint, fake vault; cross-campaign attacks; money
  conservation.
- `merchant.test.ts` — shop orders: reference and memo; **instant payout by the
  completing contribution**; refusing to complete an order without paying the
  shop; wrong reference; wrong recipient; stray tokens; a recipient completing
  their own campaign.
- `campaign.test.ts`, `contribute.test.ts`, `payout.test.ts` — each
  instruction's rules and refusals.
- `validation.test.ts` — input limits, and a maximal campaign still fitting in
  one transaction.
- `no-admin-keys.test.ts` — no privileged signer anywhere in the interface.

---

## 3. Idea and choice of problem (20%)

**Group collections are one of the most common financial relationships people
have** — a birthday gift, a shared trip deposit, a flat's new sofa, a team
lunch, a local cause — and one of the least protected. The standard solution is
"send it to me and I'll sort it out": one person's bank account, or a platform
holding the money. Every participant is exposed to the organiser's honesty,
memory and solvency, and to the platform's rules and fees.

It is a good fit for this challenge because:

- **The intermediary is unambiguous.** One party holds everyone's money; take
  them away and the relationship still works.
- **The rules are simple and universally understood** — "if we reach the goal
  it goes to Anna; if not, everyone gets their money back" — so enforcing them
  in code changes nothing about how people think, only who they must trust.
- **Failure is common and painful.** Collections that fall short, organisers
  who disappear, money spent early, refunds that never come. Each maps to a rule
  the program enforces.

**Target users** are groups of friends, students, flatmates and small
communities — mostly people with no interest in crypto. The app therefore never
says "PDA" or "lamport", keeps money in **USDC** (a 400 zł gift in three weeks
cannot ride SOL's exchange rate), names actions in plain language (*Contribute*,
*Get my money back*), explains every campaign's state in a sentence, and shows
technical details only as proof (Explorer links).

---

## 4. Implementation potential (15%)

What already points at production:

- **Real money is a build flag away.** `USDC_MINT` is chosen at build time:
  `--features mainnet` uses Circle's USDC (`EPjFWdd5…`), `--features devnet`
  devnet USDC, and a plain build a local test mint. A deployed program accepts
  exactly one token, forever.
- **Shops can use it today, with their existing tools.** Checkout is a standard
  [Solana Pay](https://docs.solanapay.com/spec) transfer link; a shop sends
  customers to `/create?pay=<link>` as a "Pay together" button, and confirms
  payment by its reference ([docs/MERCHANTS.md](docs/MERCHANTS.md)). Solana Pay
  for Shopify already exists (maintained by MoonPay Commerce), so connecting
  real stores is integration work, not a redesign. For shops we recommend
  receiving into a Squads multisig vault.
- **Nothing to operate.** The app is a static site (`npm run build` →
  `app/dist/`); there is no server to run, secure or pay for.
- **Scales past RPC.** All reads go through the `CampaignIndex` interface
  (`app/src/lib/indexer/`), so an indexing service such as Helius can replace
  plain `getProgramAccounts` without touching the pages.
- **Trust can be finalised.** `make-immutable.sh` removes the last lever the
  authors hold.

What stands between this and real users is listed honestly in
[Known limitations](#known-limitations-and-next-steps): an audit, the immutable
upgrade decision, hosting, and a fiat on-ramp.

---

## 5. Originality (10%)

Crowdfunding with an on-chain escrow is not new by itself. What is:

- **The order is paid by the act that completes it.** The contribution that
  reaches the goal pays the shop in the same atomic transaction, tagged with
  the shop's Solana Pay order reference. For a shop order the program *requires*
  it (`PayoutAccountsRequired`), so there is no moment where the money is
  collected but unpaid, and no one who has to remember to send it on.
  Verifiable in `merchant.test.ts`.
- **Group payment as a checkout option.** Any shop that already speaks Solana
  Pay can offer "Pay together" without an account, an API key or a server of
  ours — there isn't one.
- **Invite-only campaigns enforced by the program**, using a throwaway keypair
  whose secret lives only in the link fragment and QR code.
- **"Prove it" buttons.** The app deliberately sends transactions it knows will
  fail — an early payout, a contribution without an invite — so anyone can see
  on Explorer that the program, not the website, says no.
- **Plain-language state.** Every campaign page explains, from on-chain state
  only, who can do what right now, and every rule sentence maps to a check in
  the program.

---

## Technical reference

### Architecture

```
program/                                  Anchor workspace — all rule enforcement
  programs/fundraiser/src/
    lib.rs                                the seven instructions
    state.rs                              Campaign (+ status enum) and Contribution
    payout.rs                             the one payout path, shared by withdraw and contribute
    events.rs                             one event per state change
    error.rs                              named errors (append-only: codes are positional)
    constants.rs                          seeds, size limits, USDC_MINT per cluster
    instructions/                         create_campaign, update_recipient, contribute,
                                          withdraw, refund, cancel, close_campaign
  tests/litesvm/                          LiteSVM suite (time travel, no validator)

app/                                      static frontend — no backend, no database
  src/lib/program.ts                      Anchor client, PDA and token-account helpers
  src/lib/actions.ts                      builds contribute (incl. instant payout) and withdraw
  src/lib/indexer/                        CampaignIndex: plain RPC today, an indexer later
  src/lib/solanaPay.ts                    parses Solana Pay transfer links
  src/lib/paymentCheck.ts                 how a shop finds and verifies its payment
  src/lib/sns.ts                          .sol names (read-only mainnet lookup)
  src/lib/send.ts                         signs, sends, reports what the chain did
  src/lib/errors.ts, explain.ts           program errors and rules in plain language
  src/pages/                              home, campaigns, create, campaign, leaderboard, demo shop

scripts/                                  env, airdrop, devnet deploy, local seed, make-immutable
docs/MERCHANTS.md                         integration guide for shops
docs/ANALYSIS.md                          what is trustless for shops and what is not
```

**Accounts.** `Campaign` is a PDA at `["campaign", organizer, campaign_id]`
holding the rules and a stored status (Active → Succeeded → Withdrawn, or
Active → Cancelled). Its **vault** is the campaign's associated USDC account;
only the campaign PDA can sign for it. `Contribution` at `["contribution",
campaign, contributor]` is the refund receipt. Fixed-size fields come first, so
the app filters with `memcmp` at fixed offsets (organiser 8, recipient 40, mint
72, campaign id 104, status 112; `Contribution.campaign` at 8).

**Mint per cluster.**

| Build | Mint |
|---|---|
| `anchor build -- --features mainnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `anchor build -- --features devnet` | Circle devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `anchor build` (localnet, tests) | test mint `BSMC8D2tMSKrz5HFsNKJmAHDDsocVD5MypWD9podcoUe` (public seed; play money) |

**`.sol` names.** Addresses show the wallet's primary Solana Name Service name
when it has one. SNS lives on mainnet, so this is a read-only *name* lookup
there — no money or transaction ever goes to mainnet. The full address stays
visible: a name is a label anyone can register, not proof of identity. Set
`VITE_SNS_RPC_ENDPOINT` to a dedicated mainnet RPC; the public one rate-limits.

### Running it

**Prerequisites**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.2.0 && avm use 1.2.0
source scripts/env.sh   # in every shell afterwards
```

On Windows use WSL (convert `scripts/*.sh` with `dos2unix` if bash refuses them).

**Frontend against devnet**

```bash
cd app && npm install && npm run dev      # http://localhost:5173
```

Set your wallet (Phantom, Solflare, Backpack) to **Devnet**. SOL:
[faucet.solana.com](https://faucet.solana.com); USDC:
[faucet.circle.com](https://faucet.circle.com) (Solana Devnet).

**Everything on a local validator** (fastest way to try all of it)

```bash
cd program && anchor build && cd ..       # localnet build (test mint)
solana-test-validator --ledger program/test-ledger --reset --quiet \
  --upgradeable-program HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw program/target/deploy/fundraiser.so ~/.config/solana/id.json
./scripts/seed-local.sh                   # test USDC + campaigns in every state
cd app && VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
```

Set the wallet to **Localnet** (`http://127.0.0.1:8899`) and use **Get test
SOL** / **Get test USDC** in the app.

**Deploying to devnet**

```bash
solana config set --url devnet
./scripts/airdrop.sh                      # fund the deploy wallet (~1.5 SOL)
./scripts/deploy-devnet.sh                # devnet build, deploy, copy the IDL into the app
```

`deploy-devnet.sh` refuses to deploy unless the build accepts devnet USDC and
`program/target/deploy/fundraiser-keypair.json` matches `declare_id!` (the
keypair is gitignored; without it, `anchor keys sync` moves the program to a new
address).

---

## Known limitations and next steps

- **The program is still upgradeable** until `make-immutable.sh` is run.
- **The devnet deployment predates the instant payout**; redeploying the
  current build is pending.
- **`.sol` names are unverified live** — the public mainnet RPC rate-limited
  our network. The lookup fails quietly (address only).
- **No real Shopify store connected.** It needs a live store and mainnet USDC;
  our flow already accepts the Solana Pay links such stores produce.
- **Shops cannot set an expiry** — the customer picks the deadline
  ([MERCHANTS.md](docs/MERCHANTS.md#4-short-checkout-expiry-is-not-supported-directly)).
- **`@solana/pay`'s `validateTransfer` rejects Chip In payouts** (it expects a
  top-level transfer); shops verify by balance change (`paymentCheck.ts`).
- **No Solana Pay transaction-request endpoint** — that needs a server, which
  the project deliberately has none of.
- **Private is not secret** (all chain data is public), **invite links can be
  forwarded**, and **nicknames are not identity**.
- **Deposits.** A receipt deposit is returned with a refund but stays locked if
  the goal is reached; `close_campaign` has no button yet. USDC sent straight to
  a vault (not via *Contribute*) is never paid out or refunded.
- **Search runs in the browser** — past a few thousand campaigns it needs an
  indexer (the `CampaignIndex` interface is ready for one).
- **Not audited.** Devnet and test money only. Do not use with real funds.
