# Chip In — a group fundraiser with no middleman

A group of friends pools USDC for a shared goal. The money sits in a Solana
program that nobody controls. Once the goal is reached, anyone can trigger the
payout — and it can only go to the person it was collected for. If the goal
is missed by the deadline, or the organiser calls it off first, every
contributor takes back exactly what they put in. Nobody — not the organiser,
not us — can bend those rules once a campaign exists.

Built for the Superteam Poland "Finance Without Intermediaries" challenge.
Devnet only. No real money.

- **Program ID:** `HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw` (declared in
  `program/programs/fundraiser/src/lib.rs`)
- **Anchor** 1.2.0 · **Agave** (solana-cli) 4.3.0 · program toolchain pinned in
  `program/rust-toolchain.toml`

> **Deployment status.** Deployed to devnet on 2026-10-04
> ([Explorer](https://explorer.solana.com/address/HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw?cluster=devnet)),
> built for Circle's devnet USDC. The program passes its full test suite and
> the frontend has been driven end to end against a local validator. On devnet
> so far: a campaign was created through the app and an early payout was
> refused on chain (`GoalNotReached`). Contributing and paying out with devnet
> USDC on devnet: [TODO: devnet end-to-end run with devnet USDC]. The program
> is **still upgradeable** — see [Can the authors change anything?](#can-the-authors-change-anything).

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

**Here.** The pot is the campaign's own USDC account (its *vault*), whose only
authority is the program. No human key can move it. The money can leave it in
exactly two ways, both written into the program:

| | |
|---|---|
| Goal reached | Anyone can trigger the payout; it goes only to the recipient |
| Goal missed by the deadline, or campaign cancelled | Each contributor takes back their exact contribution |

The organiser is reduced to the person who filled in the form. They pay the
small deposits that open the campaign and its vault, can fix a mistyped
recipient *before anyone contributes*, and can call the campaign off *before
the goal is reached* — which only ever opens refunds. They can never take,
redirect or freeze anyone's money.

### Target user

Groups of friends, students, flatmates and small teams pooling money for a
gift, a trip or a shared purchase. Mostly people with no interest in crypto.
The UI never says "PDA" or "lamport", shows campaign money in USDC and fees
in SOL, and names the actions in plain language: *Contribute*, *Send the money
to the recipient*, *Get my money back*. Technical details appear only where
they serve as proof — the Solana Explorer links.

### Why USDC

A pot that has to buy a 400 zł gift in three weeks cannot ride SOL's exchange
rate. USDC keeps the goal meaning the same thing on the deadline as on day one.
The program accepts exactly one mint, chosen at build time (see
[Mint per cluster](#mint-per-cluster)).

---

## Where the intermediary disappears

Every rule is a check in the on-chain program. The frontend can offer any
button it likes; the program is what decides.

### `withdraw` — anyone can trigger it, only the recipient can receive it
`program/programs/fundraiser/src/instructions/withdraw.rs`

```rust
// Accounts: the recipient is pinned to what the campaign stored...
has_one = recipient @ FundraiserError::NotRecipient,
// ...and the destination must be the recipient's own USDC account.
associated_token::mint = mint,
associated_token::authority = recipient,

// handle_withdraw: only once the goal is reached, and only once
CampaignStatus::Active    => return err!(FundraiserError::GoalNotReached),
CampaignStatus::Withdrawn => return err!(FundraiserError::AlreadyWithdrawn),
CampaignStatus::Cancelled => return err!(FundraiserError::CampaignCancelled),
```

Withdraw is **permissionless**: whoever calls it pays the fee, and exactly
what was contributed goes to the stored recipient — never to the caller. So
the payout does not depend on any one person being around, and it can happen
as soon as the goal is met, even before the deadline. Contributions are capped
at the goal (`ExceedsGoal`), so the payout always equals the goal; USDC sent to
the vault outside `contribute` is never paid out.

When a campaign was created from a shop's [Solana Pay](https://docs.solanapay.com/spec)
payment request, it stores the request's `reference` and `memo`. Every payout
must then carry that exact reference account, read-only (`ReferenceRequired`,
`WrongReference`), so the shop can always find it — whoever triggers it.

### `refund` — each contributor, their own money, only on failure
`program/programs/fundraiser/src/instructions/refund.rs`

```rust
CampaignStatus::Cancelled => {}                         // refunds open at once
CampaignStatus::Active    => require!(now >= campaign.deadline, DeadlineNotReached),
CampaignStatus::Succeeded | CampaignStatus::Withdrawn => return err!(GoalReached),
```

The amount paid out is the contributor's own receipt, not a share of whatever
is left. The receipt (`Contribution`) lives at `["contribution", campaign,
contributor]`, so a contributor can only ever reach their own, and `close =
contributor` deletes it as it pays out — which is what makes a second refund
impossible. Refunds need nobody's permission and have no expiry.

### `contribute` — anyone, while it is open, to the recipient they saw
`program/programs/fundraiser/src/instructions/contribute.rs`

```rust
require!(campaign.status == CampaignStatus::Active, FundraiserError::CampaignNotActive);
require!(now < campaign.deadline,                   FundraiserError::DeadlinePassed);
require_keys_eq!(campaign.recipient, expected_recipient, FundraiserError::RecipientChanged);
```

USDC moves with `transfer_checked` from the contributor's own token account
into the vault. Every account is pinned by an Anchor constraint: the mint
must be the campaign's, the source must belong to the contributor, the
destination must be the campaign's vault at its canonical address. The
contribution that reaches the goal switches the campaign to *Succeeded*, and
from then on it takes no more money. `expected_recipient` is the recipient
the contributor was shown: if the organiser changed it in the meantime, the
contribution is refused.

### `update_recipient` and `cancel` — the organiser's only two powers
`update_recipient` fixes a mistyped recipient, but only while nothing has
been raised (`RecipientLocked` afterwards): the first contribution locks it
for good. `cancel` calls a campaign off, but only while it is still open
(`GoalReached` once the goal is met). It moves no money; it opens refunds.

### Private campaigns — only invite-link holders can join

```rust
if let Some(expected) = ctx.accounts.campaign.invite {
    let invite = ctx.accounts.invite.as_ref().ok_or(FundraiserError::InviteRequired)?;
    require_keys_eq!(invite.key(), expected, FundraiserError::InvalidInvite);
}
```

When an organiser creates a private campaign, the app generates a fresh
**invite keypair**. Only its public key goes on chain (`Campaign.invite`). The
secret half becomes the share link — `/c/<campaign>#invite=<secret>` — and the
QR code. The program refuses any contribution that is not co-signed by that
key, so "only people with the link can join" is a rule in the program, not in
the page. The secret sits in the URL **fragment**, which browsers never send
to a server, and it unlocks nothing except contributing to that one campaign:
withdraw and refund never need it.

### What is *not* in the program
No admin key, no platform fee, no pause switch, no "edit campaign", no partial
or milestone payout, and no way to change goal, deadline or mint, ever. These
are absent by construction — if an instruction does not exist, nobody can
call it. (An earlier version had a KYC verifier key deciding who could open
public campaigns; it was removed as a privileged key.)

---

## Recipient names (.sol)

Every address in the app shows the wallet's primary **Solana Name Service**
name in front of it when it has one (e.g. `anna.sol`), so people can recognise
who receives the money. SNS lives on mainnet, so this is a **read-only name
lookup on mainnet** — no transaction or money ever goes there. The full address
stays visible next to the name: anyone can register a free name, so a name is
a label, not proof of identity. Stale names (transferred since being set) are
not shown. The public mainnet RPC rate-limits heavily; set
`VITE_SNS_RPC_ENDPOINT` to a dedicated mainnet RPC for a real deployment
(`app/src/lib/sns.ts`).

## Who can call what

| Instruction | Who may sign | Conditions enforced on chain | Rejects with |
|---|---|---|---|
| `create_campaign` | Anyone (becomes the organiser) | mint is the configured USDC; `goal > 0`; `deadline > now`; recipient set; title ≤ 64 bytes; ≤ 5 tags; description ≤ 300 bytes; image link empty or `https://`, ≤ 200 bytes; optional Solana Pay reference and memo (≤ 64 bytes); optional invite key makes it private | `WrongMint`, `InvalidGoal`, `InvalidDeadline`, `InvalidRecipient`, `TitleTooLong`, `TooManyTags`, `DescriptionTooLong`, `ImageUrlTooLong`, `InvalidImageUrl`, `MemoTooLong` |
| `contribute` | Anyone (public) · invite-link holders only (private) | status Active; `now < deadline`; `0 < amount ≤ goal − raised` (the remaining amount is logged when refused); recipient unchanged; nickname ≤ 32 bytes; invite co-signs if private. **The contribution that reaches the goal pays the recipient in the same transaction** when it carries the payout accounts — mandatory for shop orders, so a shop is paid the instant the group completes | `CampaignNotActive`, `DeadlinePassed`, `InvalidAmount`, `ExceedsGoal`, `RecipientChanged`, `NicknameTooLong`, `InviteRequired`, `InvalidInvite`, `WrongMint`, `PayoutAccountsRequired`, `NotRecipient`, `WrongRecipientAccount`, `ReferenceRequired`, `WrongReference` |
| `withdraw` | **Anyone** — pays exactly `total_raised` (= the goal) only to `campaign.recipient`. A fallback: usually the completing contribution has already paid out | status Succeeded (goal reached); once; carries the campaign's reference account if it has one | `GoalNotReached`, `AlreadyWithdrawn`, `CampaignCancelled`, `NotRecipient`, `ReferenceRequired`, `WrongReference` |
| `refund` | **Only the contributor of that receipt** | cancelled, or deadline passed with the goal missed | `DeadlineNotReached`, `GoalReached` |
| `cancel` | **Only `campaign.organizer`** | status Active (goal not reached) | `NotOrganizer`, `GoalReached`, `CampaignCancelled` |
| `update_recipient` | **Only `campaign.organizer`** | status Active and nothing raised yet; sets recipient, reference and memo together | `NotOrganizer`, `RecipientLocked`, `CampaignNotActive`, `InvalidRecipient`, `MemoTooLong` |
| `close_campaign` | **Only `campaign.organizer`** | paid out, or every refund taken; vault empty | `CampaignNotSettled`, `NotOrganizer` |

`close_campaign` is housekeeping: it returns the organiser's own deposits
(campaign and vault) once nothing is left to settle. It is unreachable while
any contributor is still owed a refund, and the token program refuses to close
a vault that is not empty, so it can never touch contributor money.

Time is always `Clock::get()?.unix_timestamp` — the cluster's clock, not a
timestamp passed in by a caller. All arithmetic is checked. Every state change
emits an event: `CampaignCreated`, `RecipientUpdated`, `Contributed`,
`Withdrawn`, `Refunded`, `Cancelled`.

### Mint per cluster

`USDC_MINT` is fixed at build time by a cargo feature, so a deployed program
accepts exactly one token and nobody can change it later:

| Build | Mint |
|---|---|
| `anchor build -- --features mainnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| `anchor build -- --features devnet` | Circle's devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| `anchor build` (localnet, tests) | a test mint `BSMC8D2tMSKrz5HFsNKJmAHDDsocVD5MypWD9podcoUe` |

The localnet test mint's key comes from a public seed
(`sha256("chip-in:localnet-test-usdc:v1")`) and is also its own mint
authority, so anyone can mint it on a local validator — it is play money that
exists nowhere else. Enabling both `devnet` and `mainnet` is a compile error.

---

## Private vs public campaigns

| | 🔒 Private — friend groups | 🌍 Public — crowdfunding |
|---|---|---|
| Typical use | Trip to New Zealand, a leaving gift, a shared flat purchase | A cause or community project anyone can back |
| Who can contribute | Only holders of the invite link / QR code — **enforced by the program** | Anyone |
| Listed in the app | Only for people already in it | For everyone |
| Payout, refund and cancel rules | Identical | Identical |

**Private does not mean secret.** Every account on Solana is public. Anyone
scanning the chain can see that a private campaign exists, its title, goal and
contributions. "Private" means it is not advertised by this app and that
strangers cannot contribute to it. Anyone who has the link can forward it.

### Sharing

Every campaign page has a share panel: a **QR code**, **Copy link**, the
phone's native **Share…** sheet where supported, and **Download QR**. Under
the QR code you choose what scanning it opens:

- **Any browser** — the campaign page.
- **Phantom app** / **Solflare app** — the same page inside that wallet's
  in-app browser, ready to contribute, via the wallets' documented "browse"
  links ([Phantom](https://docs.phantom.com/phantom-deeplinks/other-methods/browse),
  [Solflare](https://docs.solflare.com/solflare/technical/deeplinks/other-methods/browse)).

A phone cannot open a page served from `localhost`; the panel says so. Host
the app publicly (it is a static site) for real-world sharing.

**About Solana Pay transaction requests.** A true transaction-request QR
(`solana:https://…`) makes the wallet fetch a ready-built `contribute`
transaction from a server. This project has no server by design, so that
endpoint is not included. The building block is: `buildContributeTransaction`
in `app/src/lib/actions.ts` builds exactly that transaction with no React and
no wallet, and the comment there describes what the endpoint would do. Private
campaigns could not use it, since their invite key must co-sign in the
contributor's browser.

**Don't send USDC straight to a campaign address.** A wallet "send" to the
campaign address would land in the vault without a receipt: it would not count
toward the goal and could not be refunded. The campaign page says so next to
the address. Use *Contribute*.

### Paying a store

A shop can send customers to `/create?pay=<url-encoded Solana Pay link>`.
Recipient, amount (the goal) and order name come from the link and are locked;
the link's `reference` and `memo` are stored in the campaign, so every payout
carries them, whoever triggers it. The shop confirms payment by looking up its
reference and checking that its USDC went up by exactly the order total
(`app/src/lib/paymentCheck.ts`). `/demo-shop` is a working example.

The create form's recipient field also accepts such a link pasted by hand; the
app warns when it asks for SOL or another token.

For shops: [docs/MERCHANTS.md](docs/MERCHANTS.md). What this does and does not
remove the need to trust: [docs/ANALYSIS.md](docs/ANALYSIS.md#shop-payments-what-is-trustless-and-what-is-not).

### Tags, search and nicknames

Each campaign carries **up to five tags**, fixed at creation, stored as a
`u32` bitmask in `Campaign.tags`; the meaning of each bit is in
`app/src/lib/tags.ts` (bits are never renumbered). The **Campaigns** page is
the search: free text, tag chips, public/private tabs, status filter and sort,
all kept in the URL. There is no search server: the browser filters what
`getProgramAccounts` returns.

Contributors pick a name for the group when they contribute — "Kuba", "Ola".
It is stored on chain in their own receipt (≤ 32 bytes), per campaign, and is
self-chosen and unverified: it helps friends tell each other apart, it is not
identity.

---

## What if a party disappears?

**The organiser vanishes.** Nothing changes. They hold no power over the money
to begin with. Contributions, the payout and refunds all work without them.
The only thing they lose is their own deposits, which `close_campaign` would
have returned.

**The recipient vanishes.** The payout still happens: anyone can trigger it,
and the money lands in the recipient's account, waiting for them. Nobody else
can receive it.

**A contributor vanishes.** Their refund waits for them indefinitely. There is
no claim deadline and no expiry. Nobody can claim it on their behalf or sweep
it.

---

## Can the authors change anything?

**While the program is upgradeable, yes — and you should know exactly how.**
Whoever holds the upgrade authority (the wallet that deploys it:
[TODO: deploy wallet address once deployed]) can replace the program's code at
the same address, which would mean replacing the rules this project rests on.
No careful check in the code protects you from a changed program.

What the authority holder **cannot** do is reach into existing campaigns with
the current code: there is no admin instruction and no privileged key in the
program. The only lever is a full code replacement.

**To remove even that lever**, discard the upgrade authority:

```bash
./scripts/make-immutable.sh          # asks you to type a confirmation
# equivalent to:
solana program set-upgrade-authority <PROGRAM_ID> --final
```

After that nobody, including us, can ever upgrade the program — no bug fix,
no recovery. The plan is to do this before submission; it **has not been
done yet**. Check the current state yourself:

```bash
solana program show HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw --url devnet
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
only when the money is gone.

Three properties are doing the work here, and none of them come from a
database:

1. **The money and the rules sit together.** The vault holds the USDC and only
   the program can move it, under the rules stored next to it. There is no
   step where the rules say one thing and the bank account does another.
2. **Nobody can execute what isn't written.** "Please let me take the money
   early" is not a request anyone can grant; every validator enforces the same
   checks.
3. **Anyone can verify it, now and later.** Contributors can read the deployed
   bytecode, the campaign's state and every transaction without asking us. And
   with `--final`, the authors can provably remove themselves.

For four flatmates who trust each other, a shared spreadsheet is fine. This
is worth it when the people pooling money do not all trust the same person.

---

## What lives where

```
program/                                  Anchor workspace — all rule enforcement
  programs/fundraiser/src/
    lib.rs                                the seven instructions
    state.rs                              Campaign (+ status enum) and Contribution
    events.rs                             one event per state change
    error.rs                              named errors (GoalNotReached, …)
    constants.rs                          seeds, size limits, USDC_MINT per cluster
    instructions/                         create_campaign, update_recipient, contribute,
                                          withdraw, refund, cancel, close_campaign
  tests/litesvm/                          LiteSVM suite (time travel, no validator)

app/                                      static frontend — no backend, no database
  src/lib/program.ts                      Anchor client, PDA and token-account helpers, USDC_MINT
  src/lib/indexer/                        CampaignIndex: RPC (getProgramAccounts) today
  src/lib/campaign.ts                     campaign model and status
  src/lib/actions.ts                      buildContributeTransaction (Solana Pay extension point)
  src/lib/format.ts                       exact USDC parsing/formatting; SOL for fees
  src/lib/solanaPay.ts                    parses Solana Pay transfer links
  src/lib/send.ts                         signs, sends, and reports what the chain did
  src/lib/errors.ts                       program errors in plain language
  src/lib/explain.ts                      the "What can happen now" wording
  src/lib/testUsdc.ts                     "Get test USDC" on a local validator
  src/pages/                              home, campaigns (search), create, campaign, leaderboard

scripts/
  env.sh                                  puts the toolchain on PATH
  airdrop.sh                              devnet SOL for demo wallets
  deploy-devnet.sh                        devnet build + deploy + sync IDL into the app
  make-immutable.sh                       discard the upgrade authority (not run yet)
  seed-local.sh / .ts                     local validator: test USDC + campaigns in every state
```

The app reads campaigns with `getProgramAccounts` filtered by account type and
by mint (`memcmp` at offset 72), and a campaign's contributors with one
`memcmp` at offset 8 against `Contribution.campaign`. Fixed-size fields come
first in `Campaign` so they sit at fixed offsets (organiser 8, recipient 40,
mint 72, campaign id 104, status 112). Reads go through the `CampaignIndex`
interface in `app/src/lib/indexer/`, so an indexing service such as Helius can
replace plain RPC later without touching the pages. Balances and status always
come from the chain.

---

## Running it

### Prerequisites

```bash
# Rust, Solana (Agave) CLI and Anchor
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 1.2.0 && avm use 1.2.0

source scripts/env.sh   # in every shell afterwards
```

On Windows, use WSL. The repository's shell scripts may be checked out with
CRLF line endings there; convert them (`dos2unix scripts/*.sh`) or run their
commands directly if bash refuses them.

### Tests

The suite runs in-process on [LiteSVM](https://github.com/LiteSVM/litesvm): no
validator, and deadlines are passed by moving the clock rather than waiting.

```bash
cd program
npm install
anchor build
npm test                                          # the whole suite
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/litesvm/security.test.ts   # one file
npx ts-mocha -p ./tsconfig.json -t 1000000 'tests/litesvm/**/*.test.ts' -g "double refund"   # by name
```

What the suite covers (`program/tests/litesvm/`):

- `security.test.ts` — the end-to-end scenarios: happy path with every event;
  goal missed, everyone refunds, double refunds fail; cancel, everyone
  refunds, payout refused; unauthorised cancel / recipient change; payout
  unable to redirect; late contribution, wrong mint, fake vault;
  cross-campaign attacks; money conservation.
- `campaign.test.ts`, `contribute.test.ts`, `payout.test.ts` — each
  instruction's rules and refusals.
- `validation.test.ts` — input limits, and a campaign with every field at its
  maximum still fitting in one transaction with headroom.
- `no-admin-keys.test.ts`, `harness.test.ts` — no privileged key left in the
  interface; the harness itself.

LiteSVM must be the 1.x line: the 0.3 line (and `anchor-litesvm`, which wraps
it) cannot load SBPF v3 programs, which Agave 4.x builds. `tests/litesvm/provider.ts`
is the small Anchor provider that bridges this project's web3.js v1 client to
LiteSVM 1.x.

### Getting devnet SOL and devnet USDC

- **SOL** (fees and deposits): `./scripts/airdrop.sh <ADDRESS>`, or the web
  faucet at <https://faucet.solana.com>, which has a separate, more generous
  limit. The CLI faucet rate-limits by IP.
- **USDC**: Circle's faucet at <https://faucet.circle.com> — choose Solana
  Devnet and paste your wallet address. That is the mint the `devnet` build
  accepts (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). The app's
  wallet bar links to it.

### Deploying to devnet

A fresh deployment; there is no previous devnet deployment to migrate.

```bash
solana config set --url devnet
./scripts/airdrop.sh                 # fund the deploy wallet
./scripts/deploy-devnet.sh
```

The 2026-10-04 deploy of the current build (278,536 bytes) cost 1.418 devnet
SOL in total: 1.416 SOL rent held by the program's data account, the rest in
fees. A larger build costs more.

`deploy-devnet.sh` builds with `--features devnet`, refuses to continue if
the build would not accept devnet USDC, deploys, and copies the IDL, types
and error codes into `app/src/idl/` so the app talks to exactly what was
deployed.

It also refuses if `program/target/deploy/fundraiser-keypair.json` is not
the keypair for the address in `declare_id!`, because a program deployed at
any other address rejects every call. That keypair is gitignored. If you do
not have the original, deploy under a new address instead:

```bash
cd program && anchor keys sync && cd ..   # writes the keypair's address into lib.rs and Anchor.toml
./scripts/deploy-devnet.sh
```

### The frontend

```bash
cd app && npm install && npm run dev     # http://localhost:5173, against devnet
npm run build                            # static site in app/dist/
```

Connect Phantom, Solflare or Backpack (any Wallet Standard wallet appears
automatically), set to **Devnet** in the wallet's own settings.

### Running the whole flow on a local validator

Useful when the devnet faucet is rate-limiting, and the fastest way to try
everything. Build without features (the test mint), then:

```bash
# 1. validator, with the program loaded at its declared address
solana-test-validator --ledger program/test-ledger --reset --quiet \
  --bpf-program HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw program/target/deploy/fundraiser.so

# 2. test USDC and campaigns in every state (open, goal reached, paid out,
#    cancelled, goal missed)
./scripts/seed-local.sh

# 3. the app
cd app && VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
```

**Point your wallet at the same network, or nothing will work.** In Phantom:
*Settings → Developer Settings → Testnet Mode*, then set Solana to
**Localnet** (`http://127.0.0.1:8899`). Then use **Get test SOL** and **Get
test USDC** in the app's wallet bar.

---

## Demo walkthrough

Two or three wallets: **A** organises, **B** and **C** contribute. On devnet,
fund them with SOL and Circle devnet USDC (above); locally, use the app's
*Get test SOL* / *Get test USDC*.

**Campaign 1 — it succeeds**

1. **A** creates "Leaving gift for Anna": goal **50 USDC**, recipient A's own
   wallet or a store's Solana Pay link.
2. **B** contributes **20 USDC**.
3. **C** clicks **"Try to pay out early (demo)"** — *this is the moment the
   point is made*. The transaction is sent with `skipPreflight: true`, so it
   is really submitted and really rejected by the program with
   `GoalNotReached`, with a link to the **failed transaction** on Solana
   Explorer. The web page did not stop C. The program did.
4. **C** contributes **30 USDC**. The badge flips to **Goal reached**.
5. **C** — not the recipient — clicks **Send the money to the recipient**. The
   review shows that none of it passes through C's wallet. The recipient
   receives exactly 50 USDC.

**Campaign 2 — it is called off**

6. **A** creates "Ski trip deposit", goal **500 USDC**. **B** contributes
   **30 USDC**.
7. **A** clicks **Cancel campaign**. The review says it only opens refunds.
8. **B** clicks **Get my money back** and receives exactly 30 USDC. Clicking it
   again fails: the receipt is gone.

**Campaign 3 — private, for friends** (optional)

9. **A** creates "Trip to New Zealand" as **Private**; the page opens on the
   invite panel with a QR code.
10. **C**, without the link, clicks **"Try to contribute without the invite
    (demo)"**: the program rejects it with `InviteRequired`.
11. **B** opens the invite link, picks the nickname "Kuba" and contributes.

---

## Known limitations and next steps

- **The program is still upgradeable** until `make-immutable.sh` is run. See
  [Can the authors change anything?](#can-the-authors-change-anything).
- **No Solana Pay transaction-request endpoint** (no server by design); the
  share QR can open the page inside Phantom or Solflare instead. See
  [Sharing](#sharing).
- **Shops cannot set an expiry.** The customer picks the deadline, and a
  payout cannot be stopped once the goal is reached. See
  [MERCHANTS.md](docs/MERCHANTS.md#4-short-checkout-expiry-is-not-supported-directly).
- **`@solana/pay`'s `validateTransfer` rejects Chip In payouts** (it expects a
  top-level token transfer); shops verify by balance change instead
  (`app/src/lib/paymentCheck.ts`).
- **No "change recipient" button yet.** The program supports correcting the
  recipient before the first contribution; the app does not offer it.
- **Deposits.** A first contribution's receipt deposit is returned with a
  refund, but stays locked if the goal is reached; `close_campaign` returns
  the organiser's deposits but has no button in the app.
- **USDC sent directly to a vault** is never paid out or refunded (no
  receipt); it stays in the vault, which then cannot be closed.
- **A custom RPC URL is treated as a local validator.** `VITE_RPC_ENDPOINT`
  exists for local development; pointing it at a dedicated devnet RPC would
  mislabel the network in the UI.
- **Private is not secret, invite links can be forwarded, nicknames are not
  identity.**
- **Search runs in the browser.** Past a few thousand campaigns it needs an
  indexer — the `CampaignIndex` interface is where one plugs in.
- **Fiat off-ramp and group voting on spending** are out of scope. The
  recipient can be any address, including a Squads multisig vault, which we
  recommend for shops ([MERCHANTS.md](docs/MERCHANTS.md#5-recommended-receive-into-a-squads-vault));
  not yet tested with a real Squads vault.
- **Not audited.** Devnet, test money, a hackathon project. Do not put real
  money anywhere near this.
