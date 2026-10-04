# Taking group payments with Chip In — for shops

A customer wants to split your bill with friends. You give them a normal
[Solana Pay](https://docs.solanapay.com/spec) transfer link; they open it in
Chip In; their group chips in; once the total is reached, the full amount
lands in your USDC account in one payment that carries your order's
reference. If the group does not make it, you receive nothing and everyone
gets their own money back.

You do not need an account with Chip In, an API key, or a server of ours —
there isn't one. You need a Solana address that can receive USDC and a way to
look up transactions (any Solana RPC).

A working example is the demo shop at `/demo-shop` in the app
(`app/src/pages/DemoShopPage.tsx`). It is a pretend café that only deals in
test money.

---

## 1. Build the payment link

Use the standard Solana Pay **transfer request** you may already produce for
single-wallet checkout:

```
solana:<your address>?amount=<total>&spl-token=<USDC mint>&reference=<reference>&label=<order name>&memo=<order id>
```

| Parameter   | Required | What Chip In does with it |
|-------------|----------|---------------------------|
| recipient   | yes      | Becomes the campaign's recipient. Locked in the form. |
| `amount`    | yes      | Becomes the goal, in USDC. Locked. Contributions are capped at it, so the payout is exactly this amount. |
| `spl-token` | yes      | Must be the USDC mint of the cluster the app runs on. A link asking for SOL or another token is refused with an explanation. |
| `reference` | strongly recommended | Stored in the campaign. The payout **must** carry it (the program refuses one that doesn't), so you can find it whoever triggers it. |
| `label`     | no       | Becomes the campaign title (cut to 64 bytes). Locked. |
| `memo`      | no       | Stored in the campaign (≤ 64 bytes) and attached to the payout through the SPL Memo program. |

Generate a **fresh reference for every order** (any new public key, e.g.
`Keypair.generate().publicKey`), exactly as for ordinary Solana Pay.

Then send the customer to Chip In with the link URL-encoded:

```
https://<chip-in host>/create?pay=<encodeURIComponent(link)>
```

[TODO: public URL of the deployed app]

The customer sees your amount, recipient and order name marked "Set by the
shop" and cannot edit them. They choose the deadline, whether the campaign is
public or invite-only, and the description.

The plain `solana:` link still works in an ordinary wallet for a customer
paying alone; the Chip In link is an additional button ("Pay together"), not a
replacement.

## 2. Verify the payment by reference

Do what Solana Pay merchants already do — find the transaction by reference,
then check it — with one difference in the check.

1. `getSignaturesForAddress(reference)` lists every transaction that carried
   your reference. Skip failed ones: a payout attempted before the goal is
   reached fails, carries the reference, and must not count.
2. For a successful one, compare the transaction's **pre and post token
   balances** for accounts owned by your address with the USDC mint. Accept
   the order only if your balance went up by **exactly** the order total.

`app/src/lib/paymentCheck.ts` implements this (`findPayment`) in about 60
lines with `@solana/web3.js` only; copy it to your server. It also returns the
memo from the transaction's logs.

**Do not use `@solana/pay`'s `validateTransfer` for Chip In payouts.**
It only accepts a transaction whose last top-level instruction is a token
transfer into your account. Chip In's payout is an instruction of the Chip In
program, which moves the USDC from the campaign's vault itself (only the
program can — that is what makes the vault safe), so `validateTransfer`
rejects it with "invalid transfer". We checked this against `@solana/pay`
1.0.26: `findReference` finds the payout; `validateTransfer` rejects it. The
balance-change check above verifies the same facts (right account, right
mint, right amount, your reference) from the transaction's result rather than
from its instruction layout.

Things worth knowing:

- **Anyone may trigger the payout** — the organiser, a contributor, or you.
  Whoever does pays the network fee [TODO: current fee in SOL], and, if your
  USDC account does not exist yet, the deposit to open it [TODO: amount in
  SOL]. The money still only goes to your account. If a group reaches the
  goal but nobody presses the button, you can press it yourself from the
  campaign page.
- **Rely on the reference and the balance change, not the memo.** The memo is
  a public label anyone could copy; it is useful for your bookkeeping, not as
  proof.
- **Never reuse a reference.** The check can only tell orders apart by it.
- Chip In charges no fee: the program has no fee account. You receive the
  full goal.

## 3. When the group misses the goal

Nothing reaches you, ever — there is no partial payment. Contributions stop
exactly at the goal and the payout is all-or-nothing. After the deadline (or
if the organiser cancels before the goal is reached) every contributor takes
back exactly what they put in, without needing you, the organiser or us.

For you this looks like an order that is never paid: the reference shows no
successful transaction. Treat it like any abandoned checkout.

## 4. Short checkout expiry is not supported directly

Many checkouts hold an order or a price for minutes. A group collection takes
as long as the group takes, up to the deadline the **customer** picked; the
link has no expiry field and Chip In does not let the shop set the deadline.

Consequences, and what to do about them:

- Once the goal is reached, the payout **cannot be stopped** — not by you, not
  by the organiser. If you had already cancelled the order by then, you still
  receive the money and must settle it yourself (deliver anyway, or refund the
  group outside Chip In).
- So hold the order (and price, and stock) at least as long as you are willing
  to wait, and tell the customer that limit in your "Pay together" flow so
  they choose a deadline within it. The app's shortest preset is 2 minutes
  (a demo setting); the program accepts any future deadline.
- If you cannot hold an order that long, offer group payment only for things
  you can fulfil late (gift cards, bookings with free cancellation, deposits),
  or issue a fresh link when the customer comes back.

A version where the shop sets an expiry that the program enforces would need
a new field in the campaign; it is not built.

## 5. Recommended: receive into a Squads vault

The payout goes to whatever address your link names. If that is a single
person's wallet, one lost or leaked key loses the shop's takings. We
recommend using a [Squads](https://squads.so) multisig vault address as the
recipient, so moving the money out needs several of your people to approve.

How it works with Chip In: put the Squads **vault** address (not the
multisig's settings account) in the link. The payout sends USDC to the
vault's associated token account and opens it if needed; no signature from
the vault is required to receive.

[TODO: tested end to end with a Squads v4 vault on devnet — not yet done; the
program accepts any address as recipient, including one that is not a wallet
key, but this has only been checked with ordinary addresses]

The trust trade-off, plainly:

- **What it adds:** protection *inside the shop*. No single employee or
  device can drain what groups paid.
- **What it costs:** you now rely on the Squads program and on whoever can
  change your multisig's members and threshold. Chip In pins the vault
  **address**, not the rules behind it: if your multisig's configuration
  changes, Chip In neither knows nor cares, and the money still goes to that
  address.
- **What it does not change for the group:** customers trusted you to
  deliver before; they still do. The multisig protects the shop from itself,
  not the customer from the shop.

A Squads vault can also be used the other way — as the recipient of a
group's campaign, with the group's members as signers who later decide where
to spend it. That reintroduces people who must approve a payment, which is
exactly what Chip In removes, so it is not what we recommend for paying a
shop.

---

See [ANALYSIS.md](ANALYSIS.md#shop-payments-what-is-trustless-and-what-is-not)
for what this integration does and does not remove the need to trust.
