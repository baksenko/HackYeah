# Chip In — group money with no middleman

**Friends pool USDC for a trip, a gift or a shared order. The money is held by
a Solana program nobody controls. Goal reached: it goes to the recipient — for
a shop order, in the very transaction that completes it. Goal missed or
cancelled: everyone takes back exactly what they paid. Nobody, not even us, can
bend these rules.**

Superteam Poland challenge **"Finance Without Intermediaries"** · devnet and
local only, no real money.

| | |
|---|---|
| Program (devnet) | [`HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw`](https://explorer.solana.com/address/HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw?cluster=devnet) |
| Stack | Anchor 1.2 (Rust) · React + TypeScript · USDC · **no backend, no database** |
| Tests | 68 passing — `cd program && npm install && anchor build && npm test` (~1 s) |
| Live demo · Video | [TODO: app URL] · [TODO: video link] |

<!-- 📸 SCREENSHOT 01 — landing page. Save as docs/screenshots/01-home.png -->
![Chip In landing page](docs/screenshots/01-home.png)

## For the jury

| Criterion | Weight | In one line |
|---|---|---|
| [Relevance](#1-relevance-to-the-challenge-30) | 30% | Every rule — who gets paid, when, refunds, who may join — is a check in the program. No admin key, no fee, no server. |
| [Completeness](#2-completeness-and-functionality-25) | 25% | 7 instructions, 68 tests, a full web app from create to payout, refund, sharing, search and shop checkout. |
| [Idea](#3-idea-and-choice-of-problem-20) | 20% | Group collections are an everyday money relationship that runs through one person's bank account. |
| [Potential](#4-implementation-potential-15) | 15% | USDC, Solana Pay for shops, a mainnet build flag, static hosting, an indexer interface. |
| [Originality](#5-originality-10) | 10% | A shop order is **paid atomically by the contribution that completes it**. |

---

## 1. Relevance to the challenge (30%)

**Today**, one person collects everyone's money — into their own bank account
or a platform like zrzutka.pl — and everyone trusts them not to spend it early,
to buy the thing, to refund if the plan fails, and to stay reachable. That
person is the intermediary.

**With Chip In** the pot is a USDC vault whose only authority is the program.
Money leaves it in exactly two ways:

| Outcome | What the program allows |
|---|---|
| Goal reached | Paid to the stored recipient — immediately by the completing contribution, or later by **anyone** pressing "pay out". Nowhere else. |
| Goal missed, or cancelled | Each contributor takes back their exact contribution. |

The organiser can only fix a mistyped recipient *before anyone contributes* and
cancel *before the goal is reached* (which only opens refunds). They can never
take, redirect or freeze money.

### Where the intermediary disappears

Rules live in `program/programs/fundraiser/src/`; the website only offers
buttons.

| Instruction | Who may call | Enforced on chain |
|---|---|---|
| `contribute` | Anyone (public) · invite holders only (private) | Open and before the deadline; never past the goal (`ExceedsGoal`); recipient unchanged since the contributor looked (`RecipientChanged`); private campaigns need the invite key's signature (`InviteRequired`). The contribution that reaches the goal **pays out in the same transaction** — mandatory for shop orders (`PayoutAccountsRequired`). |
| `withdraw` | **Anyone** | Goal reached, once, and only to the stored recipient (`GoalNotReached`, `AlreadyWithdrawn`, `NotRecipient`). |
| `refund` | Only that contributor | Cancelled, or deadline passed with goal missed; pays their own receipt, then deletes it so it can't be claimed twice. |
| `cancel` / `update_recipient` | Only the organiser | Before the goal / before any contribution. |
| `create_campaign` / `close_campaign` | Organiser | Input limits / only when fully settled. |

**Not in the program:** no admin key, no fee, no pause, no edits to goal,
deadline or token. An earlier KYC verifier key was removed as a privileged key;
`no-admin-keys.test.ts` checks none remain. Time comes from the cluster clock
and all arithmetic is checked.

**If someone disappears:** organiser — nothing changes; recipient — anyone can
still trigger the payout to them; contributor — their refund waits forever.

**Can the authors change anything?** The program is still upgradeable, so its
code could be replaced. `./scripts/make-immutable.sh` removes that for good.
[TODO: run before submission, or state the decision.]

<!-- 📸 SCREENSHOT 02 — open campaign: progress, "What can happen now", permissions table. Save as docs/screenshots/02-campaign-what-can-happen.png -->
![Campaign page explaining who can do what](docs/screenshots/02-campaign-what-can-happen.png)

---

## 2. Completeness and functionality (25%)

- **Program:** 7 instructions, USDC vault, stored status, events — 68 tests
  (security scenarios, shop orders, each instruction, input limits, no admin keys).
- **App:** public or private campaigns with tags, description and photo;
  contribute with a cost review before signing; nicknames; instant payout;
  payout button as fallback; refunds; cancel; share by link or QR (opens in a
  browser, Phantom or Solflare); search; leaderboard; `.sol` names; shop
  checkout from a Solana Pay link with a self-confirming demo shop.
- **"Prove it" buttons** send transactions the program must refuse, so anyone
  can see the refusal on Explorer.

> **Status.** Deployed to devnet on 2026-10-04 (a campaign was created and an
> early payout refused on chain). The instant payout came after that deploy and
> is verified on a local validator: one 642-byte transaction completed a
> 42 USDC shop order, paid the shop and was found by its order reference.
> [TODO: redeploy current build to devnet and run the full flow.]

### Demo walkthrough

**1 — Refused early, paid out automatically.** A creates a 50 USDC gift
campaign; B contributes 20. C clicks **"Try to pay out early (demo)"**: it
really lands and the program refuses it (`GoalNotReached`) — the website didn't
stop C, the program did. C contributes the last 30, and that same transaction
pays all 50 to the recipient.

<!-- 📸 SCREENSHOT 03 — cost review before signing (ideally the one that "completes the goal"). Save as docs/screenshots/03-review-before-signing.png -->
![Cost review before signing](docs/screenshots/03-review-before-signing.png)
<!-- 📸 SCREENSHOT 04 — result of "Try to pay out early (demo)". Save as docs/screenshots/04-early-payout-refused.png -->
![The program refuses an early payout](docs/screenshots/04-early-payout-refused.png)
<!-- 📸 SCREENSHOT 05 — that failed transaction on Solana Explorer. Save as docs/screenshots/05-explorer-failed-tx.png -->
![The refused transaction on Explorer](docs/screenshots/05-explorer-failed-tx.png)

**2 — Cancelled, refunded.** A cancels a 500 USDC ski deposit after B put in
30; B clicks **Get my money back** and receives exactly 30. A second click
fails — the receipt is gone.

**3 — Private, for friends.** A creates a private "Trip to New Zealand" and
shares the QR code. C, without the link, clicks **"Try to contribute without
the invite (demo)"** — refused with `InviteRequired`. B opens the link and
contributes as "Kuba".

<!-- 📸 SCREENSHOT 06 — share panel with QR code. Save as docs/screenshots/06-share-qr.png -->
![Invite with a link or QR code](docs/screenshots/06-share-qr.png)
<!-- 📸 SCREENSHOT 07 — private campaign opened without the invite. Save as docs/screenshots/07-private-locked.png -->
![A private campaign without the invite](docs/screenshots/07-private-locked.png)

**4 — A shop order.** On **`/demo-shop`**, click **Pay together with Chip In**;
amount, shop and order name arrive locked. The contribution that completes the
order pays the café in the same transaction, and the shop page — watching only
the chain for its order reference — flips to **"Order paid ✓"** by itself.

<!-- 📸 SCREENSHOT 08 — demo shop showing "Order paid ✓". Save as docs/screenshots/08-demo-shop-paid.png -->
![The demo shop confirms the order](docs/screenshots/08-demo-shop-paid.png)
<!-- 📸 SCREENSHOT 09 — Campaigns page with search and tags. Save as docs/screenshots/09-campaigns-search.png -->
![Search and browse](docs/screenshots/09-campaigns-search.png)
<!-- 📸 SCREENSHOT 10 — create form. Save as docs/screenshots/10-create-campaign.png -->
![Creating a campaign](docs/screenshots/10-create-campaign.png)
<!-- 📸 SCREENSHOT 11 — leaderboard. Save as docs/screenshots/11-leaderboard.png -->
![Contributor leaderboard](docs/screenshots/11-leaderboard.png)

---

## 3. Idea and choice of problem (20%)

Group collections — a gift, a trip deposit, a shared sofa, a team lunch, a
local cause — are among the most common money relationships people have and
among the least protected. The intermediary is unambiguous (whoever holds the
pot), the rules are ones everyone already agrees on ("goal reached: it goes to
Anna; otherwise everyone gets it back"), and the failures are familiar: money
spent early, refunds that never come, organisers who vanish. Each maps to a
rule the program enforces.

**Users** are friends, students, flatmates and small communities, mostly not
crypto people. So: USDC instead of a volatile token, plain-language actions
(*Contribute*, *Get my money back*), a one-sentence explanation of every
campaign's state, and technical detail only as proof (Explorer links).

---

## 4. Implementation potential (15%)

- **Real money is a build flag away:** `--features mainnet` builds for Circle's
  USDC; one deployed program accepts exactly one token.
- **Shops can use it with existing tools:** checkout is a standard
  [Solana Pay](https://docs.solanapay.com/spec) link, so "Pay together" is just
  a button (`/create?pay=<link>`). Solana Pay for Shopify already exists
  (MoonPay Commerce). Guide: [docs/MERCHANTS.md](docs/MERCHANTS.md).
- **Nothing to operate:** a static site; no server to run or secure.
- **Scales past RPC:** reads go through a `CampaignIndex` interface, ready for
  an indexer such as Helius.
- **Trust can be finalised** with `make-immutable.sh`.

Missing for real users: an audit, the immutability decision, hosting, and a
fiat on-ramp.

---

## 5. Originality (10%)

- **The order is paid by the act that completes it** — atomically, tagged with
  the shop's order reference, and required by the program for shop orders, so
  money is never collected-but-unpaid (`merchant.test.ts`).
- **"Pay together" for any Solana Pay shop**, with no account, API key or
  server of ours.
- **Invite-only campaigns enforced on chain** by a throwaway key that lives only
  in the link and QR code.
- **"Prove it" buttons** that deliberately send doomed transactions.

---

## Run it

```bash
source scripts/env.sh                                    # Rust, Agave CLI, Anchor 1.2
cd program && npm install && anchor build && npm test    # 68 tests, no validator
cd ../app && npm install && npm run dev                  # http://localhost:5173 (devnet)
```

Wallet on **Devnet**; SOL from [faucet.solana.com](https://faucet.solana.com),
USDC from [faucet.circle.com](https://faucet.circle.com). For a local validator
with demo data, and for deploying, see [CLAUDE.md](CLAUDE.md) and `scripts/`.

**Layout:** `program/` — all rules (`instructions/`, `payout.rs`, tests in
`tests/litesvm/`) · `app/` — static frontend · `docs/` — shop guide and trust
analysis.

## Known limitations

- Still upgradeable until `make-immutable.sh` is run; devnet build predates the
  instant payout.
- `.sol` names unverified live (public mainnet RPC rate-limited us); fails
  quietly to the plain address.
- No real Shopify store connected (needs a live store and mainnet USDC).
- Private is not secret (chain data is public); invite links can be forwarded;
  nicknames are not identity.
- Search runs in the browser; large scale needs an indexer.
- **Not audited** — test money only.
