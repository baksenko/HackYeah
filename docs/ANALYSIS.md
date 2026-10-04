# Analysis

Notes on what Chip In's design guarantees and where trust remains. The rules
themselves are described in the [README](../README.md#where-the-intermediary-disappears);
every claim below about the program points to a check there.

## Shop payments: what is trustless and what is not

A shop issues a Solana Pay link; a group collects the amount in a Chip In
campaign; the payout goes to the shop carrying the shop's reference. See
[MERCHANTS.md](MERCHANTS.md) for the integration.

### Enforced by the program — nobody has to be trusted

| Guarantee | Why it holds |
|-----------|--------------|
| The money can only go to the shop's address. | The recipient is written at creation (or changed by the organiser only before anything is raised); `withdraw` pins the destination to the recipient's own USDC account. There is no instruction that sends the vault anywhere else. |
| The shop receives exactly the amount it asked for, or nothing. | Contributions are refused past the goal (`ExceedsGoal`); `withdraw` runs only once the goal is reached and pays exactly `total_raised`. No partial payment exists. |
| Each contributor gets exactly their own money back if the goal is missed. | `refund` is callable by the contributor alone, after the deadline or a cancel, and closes their receipt so it cannot run twice. |
| The organiser cannot take the money, redirect it, or change the amount after people have paid. | No such instruction exists; the recipient is locked from the first contribution; goal, deadline and mint are never editable. |
| The payout does not depend on any one person. | `withdraw` is permissionless — any contributor, the organiser, or the shop can trigger it. |
| The shop can always find the payout. | When a campaign stores a reference, `withdraw` refuses to run without that exact account (`ReferenceRequired`, `WrongReference`). |
| The shop can verify the payment without trusting Chip In, the organiser or the customer. | It reads its own balance change from the transaction on chain (`lib/paymentCheck.ts`). |
| Chip In takes nothing. | There is no fee account and no admin key. |

### Not enforced — trust remains

| Remaining trust | Who trusts whom | Notes |
|-----------------|-----------------|-------|
| **Delivery.** The shop gets paid when the goal is reached, not when the goods arrive. | Group → shop | Same as paying a shop alone. Escrow until delivery would need an arbiter, i.e. a trusted party. |
| **That the link is really the shop's.** An organiser could build a campaign from a link with their own address and a shop's name. | Contributors → organiser | The campaign page shows the full recipient address with an Explorer link; contributors (or the shop's own "Pay together" button) are the defence. The program cannot know who owns an address. |
| **Late or cancelled orders.** A payout cannot be stopped once the goal is reached, even if the shop already cancelled the order. | Group → shop | The shop must deliver or refund outside Chip In. See [short expiry](MERCHANTS.md#4-short-checkout-expiry-is-not-supported-directly). |
| **The price.** Chip In collects what the link asks; it cannot tell whether that is fair. | Group → shop | As in any checkout. |
| **The shop's own key management.** | Shop → its staff | A Squads vault spreads this over several signers, at the cost of trusting the Squads program and the multisig's configuration. See [MERCHANTS.md §5](MERCHANTS.md#5-recommended-receive-into-a-squads-vault). |
| **The token.** USDC's issuer controls the mint, including the ability to freeze token accounts, which would include a campaign's vault or the shop's account. | Everyone → issuer | Inherent to using USDC; it is why the program is pinned to one mint per cluster rather than pretending otherwise. |
| **The program itself, until it is made immutable.** | Everyone → authors | The upgrade authority is removed before submission (`scripts/make-immutable.sh`). Until then the authors could replace the code. [TODO: transaction removing the upgrade authority, once done] |
| **The web page.** A modified copy of the static site could show different text or build different transactions. | Users → whoever serves the page | The wallet shows what is signed, and every rule is enforced by the program regardless of the page; Explorer links let anyone check. |
| **Liveness of someone pressing "Send".** | Shop → anyone | Permissionless, so the shop can press it itself; it only needs a little SOL for the fee [TODO: fee in SOL]. |

### Numbers

[TODO: measured costs per action on devnet — network fees and deposits for
create, contribute, payout, refund — once the program is deployed]
