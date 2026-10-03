// Step 5: withdraw (permissionless), refund, cancel and close_campaign.
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

import {
  cancel,
  closeCampaign,
  contribute,
  contributionPda,
  createCampaign,
  refund,
  tokenAccountOf,
  withdraw,
} from "./fixtures";
import { createHarness, expectError, Harness, USDC } from "./harness";

/** A campaign with `amounts` already contributed by separate wallets. */
async function funded(goalUsdc: number, amounts: number[], secondsFromNow = 3600) {
  const h = createHarness();
  const organizer = h.wallet();
  const recipient = Keypair.generate().publicKey; // has no token account yet
  const { campaign, vault } = await createCampaign(h, { organizer, recipient, goalUsdc, secondsFromNow });
  const contributors: Keypair[] = [];
  for (const usdc of amounts) {
    const c = h.wallet();
    h.fundTokens(c.publicKey, 1000 * USDC);
    await contribute(h, campaign, c, usdc * USDC);
    contributors.push(c);
  }
  return { h, organizer, recipient, campaign, vault, contributors };
}

const status = async (h: Harness, campaign: PublicKey) =>
  Object.keys((await h.program.account.campaign.fetch(campaign)).status)[0];

describe("withdraw", () => {
  it("lets anyone pay the full vault to the recipient as soon as the goal is reached", async () => {
    const { h, recipient, campaign, vault } = await funded(100, [60, 30, 15]); // 105
    assert.equal(await status(h, campaign), "succeeded");

    const stranger = h.wallet(); // not organizer, recipient or contributor
    const reference = Keypair.generate().publicKey;
    await withdraw(h, campaign, stranger, { reference }); // before the deadline

    assert.equal(h.tokenBalance(tokenAccountOf(recipient)), BigInt(105 * USDC));
    assert.equal(h.tokenBalance(vault), 0n);
    assert.equal(await status(h, campaign), "withdrawn");

    const [event] = h.events();
    assert.equal(event.name, "withdrawn");
    assert.ok(event.data.recipient.equals(recipient));
    assert.ok(event.data.caller.equals(stranger.publicKey));
    assert.equal(event.data.amount.toNumber(), 105 * USDC);
    assert.ok(event.data.reference.equals(reference), "the Solana Pay reference is recorded");
  });

  it("works without a reference account", async () => {
    const { h, recipient, campaign } = await funded(10, [10]);
    await withdraw(h, campaign, h.wallet());
    assert.equal(h.tokenBalance(tokenAccountOf(recipient)), BigInt(10 * USDC));
    assert.equal(h.events()[0].data.reference, null);
  });

  it("refuses before the goal is reached, and a second time", async () => {
    const { h, campaign, contributors } = await funded(100, [40]);
    await expectError(withdraw(h, campaign, h.wallet()), "GoalNotReached");
    await contribute(h, campaign, contributors[0], 60 * USDC);
    await withdraw(h, campaign, h.wallet());
    h.newBlockhash();
    await expectError(withdraw(h, campaign, h.wallet()), "AlreadyWithdrawn");
  });

  it("can only ever pay the stored recipient", async () => {
    const { h, campaign, vault } = await funded(10, [10]);
    const thief = h.wallet();
    // Naming a different recipient.
    await expectError(withdraw(h, campaign, thief, { recipient: thief.publicKey }), "NotRecipient");
    // Naming the right recipient but the thief's own token account as destination.
    const thiefsAccount = h.fundTokens(thief.publicKey, 0);
    await expectError(withdraw(h, campaign, thief, { recipientToken: thiefsAccount }), "ConstraintTokenOwner");
    assert.equal(h.tokenBalance(vault), BigInt(10 * USDC), "nothing left the vault");
    assert.equal(h.tokenBalance(thiefsAccount), 0n);
  });
});

describe("refund", () => {
  it("returns each contributor exactly their amount after a missed deadline, once", async () => {
    const { h, campaign, vault, contributors } = await funded(100, [30, 20]);
    const [a, b] = contributors;
    h.warp(3600);

    await refund(h, campaign, a);
    assert.equal(h.tokenBalance(tokenAccountOf(a.publicKey)), BigInt(1000 * USDC));
    assert.isFalse(h.exists(contributionPda(h, campaign, a.publicKey)), "receipt closed");
    const [event] = h.events();
    assert.equal(event.name, "refunded");
    assert.equal(event.data.amount.toNumber(), 30 * USDC);

    await refund(h, campaign, b);
    assert.equal(h.tokenBalance(tokenAccountOf(b.publicKey)), BigInt(1000 * USDC));
    assert.equal(h.tokenBalance(vault), 0n);
    assert.equal((await h.program.account.campaign.fetch(campaign)).totalRefunded.toNumber(), 50 * USDC);

    h.newBlockhash();
    await expectError(refund(h, campaign, a), "AccountNotInitialized"); // the receipt is gone
  });

  it("refuses before the deadline and once the goal was reached", async () => {
    const open = await funded(100, [30]);
    await expectError(refund(open.h, open.campaign, open.contributors[0]), "DeadlineNotReached");

    const won = await funded(100, [100]);
    won.h.warp(3600);
    await expectError(refund(won.h, won.campaign, won.contributors[0]), "GoalReached");
  });

  it("refuses to pay out someone else's receipt", async () => {
    const { h, campaign, contributors } = await funded(100, [30]);
    h.warp(3600);
    const stranger = h.wallet();
    await expectError(refund(h, campaign, stranger, { receiptOf: contributors[0].publicKey }), "ConstraintSeeds");
  });
});

describe("cancel", () => {
  it("opens refunds at once, and withdraw is then refused", async () => {
    const { h, organizer, campaign, contributors } = await funded(100, [30]);
    await cancel(h, campaign, organizer);
    assert.equal(await status(h, campaign), "cancelled");
    assert.equal(h.events()[0].name, "cancelled");

    await refund(h, campaign, contributors[0]); // before the deadline
    assert.equal(h.tokenBalance(tokenAccountOf(contributors[0].publicKey)), BigInt(1000 * USDC));
    await expectError(withdraw(h, campaign, h.wallet()), "CampaignCancelled");
    const latecomer = h.wallet();
    h.fundTokens(latecomer.publicKey, 10 * USDC);
    await expectError(contribute(h, campaign, latecomer, 1 * USDC), "CampaignNotActive");
  });

  it("is allowed after a missed deadline", async () => {
    const { h, organizer, campaign } = await funded(100, [30]);
    h.warp(3600);
    await cancel(h, campaign, organizer);
    assert.equal(await status(h, campaign), "cancelled");
  });

  it("refuses anyone but the organizer, a reached goal, and a second cancel", async () => {
    const { h, organizer, campaign } = await funded(100, [30]);
    await expectError(cancel(h, campaign, h.wallet()), "NotOrganizer");
    await cancel(h, campaign, organizer);
    h.newBlockhash();
    await expectError(cancel(h, campaign, organizer), "CampaignCancelled");

    const won = await funded(100, [100]);
    await expectError(cancel(won.h, won.campaign, won.organizer), "GoalReached");
  });
});

describe("close_campaign", () => {
  it("returns both deposits to the organizer after a payout", async () => {
    const { h, organizer, campaign, vault } = await funded(10, [10]);
    await withdraw(h, campaign, h.wallet());
    const before = h.lamports(organizer.publicKey);
    await closeCampaign(h, campaign, organizer);
    assert.isFalse(h.exists(campaign));
    assert.isFalse(h.exists(vault));
    assert.isTrue(h.lamports(organizer.publicKey) > before);
  });

  it("refuses while anyone is still owed a refund, then allows it", async () => {
    const { h, organizer, campaign, contributors } = await funded(100, [30, 20]);
    await expectError(closeCampaign(h, campaign, organizer), "CampaignNotSettled"); // still open
    h.warp(3600);
    await refund(h, campaign, contributors[0]);
    await expectError(closeCampaign(h, campaign, organizer), "CampaignNotSettled"); // one still owed
    await refund(h, campaign, contributors[1]);
    await closeCampaign(h, campaign, organizer);
    assert.isFalse(h.exists(campaign));
  });

  it("refuses anyone but the organizer", async () => {
    const { h, campaign } = await funded(10, [10]);
    await withdraw(h, campaign, h.wallet());
    await expectError(closeCampaign(h, campaign, h.wallet()), "NotOrganizer");
  });
});
