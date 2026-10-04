// Step 6: the security scenarios from the design brief, end to end, plus
// cross-campaign attacks and money-conservation checks.
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
  updateRecipient,
  vaultOf,
  withdraw,
} from "./fixtures";
import { createHarness, expectError, Harness, USDC } from "./harness";

const START_USDC = 1000;

/** Funded contributors, each starting with START_USDC. */
function people(h: Harness, n: number): Keypair[] {
  return Array.from({ length: n }, () => {
    const kp = h.wallet();
    h.fundTokens(kp.publicKey, START_USDC * USDC);
    return kp;
  });
}

const balanceOf = (h: Harness, owner: PublicKey) => h.tokenBalance(tokenAccountOf(owner));
const statusOf = async (h: Harness, campaign: PublicKey) =>
  Object.keys((await h.program.account.campaign.fetch(campaign)).status)[0];

describe("security: the brief's scenarios", () => {
  it("happy path: create, several contributions, goal reached, withdraw -- with every event", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const recipient = Keypair.generate().publicKey;
    const { campaign, vault } = await createCampaign(h, { organizer, recipient, goalUsdc: 300 });
    assert.equal(h.events()[0].name, "campaignCreated");

    const [a, b, c] = people(h, 3);
    await contribute(h, campaign, a, 100 * USDC);
    await contribute(h, campaign, b, 120 * USDC);
    assert.equal(await statusOf(h, campaign), "active");
    await contribute(h, campaign, c, 80 * USDC); // exactly 300
    const last = h.events()[0];
    assert.equal(last.name, "contributed");
    assert.equal(last.data.goalReached, true);
    assert.equal(await statusOf(h, campaign), "succeeded");

    await withdraw(h, campaign, h.wallet());
    assert.equal(h.events()[0].name, "withdrawn");
    assert.equal(balanceOf(h, recipient), BigInt(300 * USDC));
    assert.equal(h.tokenBalance(vault), 0n);
    assert.equal(await statusOf(h, campaign), "withdrawn");
  });

  it("goal missed: after the deadline each contributor refunds exactly; double refunds fail", async () => {
    const h = createHarness();
    const { campaign, vault } = await createCampaign(h, { organizer: h.wallet(), goalUsdc: 1000 });
    const contributors = people(h, 3);
    const amounts = [50, 75, 125];
    for (const [i, c] of contributors.entries()) await contribute(h, campaign, c, amounts[i] * USDC);

    await expectError(refund(h, campaign, contributors[0]), "DeadlineNotReached");
    h.warp(3600);
    for (const c of contributors) await refund(h, campaign, c);

    for (const c of contributors) {
      assert.equal(balanceOf(h, c.publicKey), BigInt(START_USDC * USDC), "everyone is made whole");
      await expectError(refund(h, campaign, c), "AccountNotInitialized");
    }
    assert.equal(h.tokenBalance(vault), 0n);
    await expectError(withdraw(h, campaign, h.wallet()), "GoalNotReached");
  });

  it("cancel: every contributor refunds at once; withdraw fails", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const { campaign, vault } = await createCampaign(h, { organizer, goalUsdc: 1000 });
    const contributors = people(h, 3);
    for (const c of contributors) await contribute(h, campaign, c, 40 * USDC);

    await cancel(h, campaign, organizer);
    await expectError(withdraw(h, campaign, h.wallet()), "CampaignCancelled");
    for (const c of contributors) await refund(h, campaign, c); // no waiting for the deadline
    for (const c of contributors) assert.equal(balanceOf(h, c.publicKey), BigInt(START_USDC * USDC));
    assert.equal(h.tokenBalance(vault), 0n);
  });

  it("unauthorized: withdraw cannot redirect, cancel and update_recipient need the organizer", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const recipient = Keypair.generate().publicKey;
    const { campaign } = await createCampaign(h, { organizer, recipient, goalUsdc: 100 });
    const attacker = h.wallet();

    await expectError(updateRecipient(h, campaign, attacker, attacker.publicKey), "NotOrganizer");
    await expectError(cancel(h, campaign, attacker), "NotOrganizer");

    const [a] = people(h, 1);
    await contribute(h, campaign, a, 50 * USDC); // still Active
    // Not even the organizer can redirect once money is in.
    await expectError(updateRecipient(h, campaign, organizer, attacker.publicKey), "RecipientLocked");
    await contribute(h, campaign, a, 50 * USDC); // goal reached
    // Withdraw is open to anyone, but only towards the stored recipient.
    await expectError(withdraw(h, campaign, attacker, { recipient: attacker.publicKey }), "NotRecipient");
    await withdraw(h, campaign, attacker);
    assert.equal(balanceOf(h, recipient), BigInt(100 * USDC));
    assert.equal(balanceOf(h, attacker.publicKey), 0n);
  });

  it("contribution after the deadline fails; wrong mint and fake vault fail", async () => {
    const h = createHarness();
    const { campaign } = await createCampaign(h, { organizer: h.wallet(), goalUsdc: 100 });
    const [a] = people(h, 1);
    const fakeUsdc = h.createMint();
    h.fundTokens(a.publicKey, 100 * USDC, fakeUsdc);
    const impostor = h.fundTokens(campaign, 0, undefined, Keypair.generate().publicKey);

    await expectError(contribute(h, campaign, a, 1 * USDC, { mint: fakeUsdc, vault: vaultOf(campaign) }), "WrongMint");
    await expectError(contribute(h, campaign, a, 1 * USDC, { vault: impostor }), "ConstraintAssociated");
    h.warp(3600);
    await expectError(contribute(h, campaign, a, 1 * USDC), "DeadlinePassed");
    assert.equal(balanceOf(h, a.publicKey), BigInt(START_USDC * USDC));
  });
});

describe("security: cross-campaign attacks", () => {
  /** Two campaigns, each holding 100 USDC from a different contributor. */
  async function twoCampaigns(goalUsdc: number) {
    const h = createHarness();
    const organizer = h.wallet();
    const A = await createCampaign(h, { organizer, goalUsdc });
    const B = await createCampaign(h, { organizer, goalUsdc });
    const [a, b] = people(h, 2);
    await contribute(h, A.campaign, a, 100 * USDC);
    await contribute(h, B.campaign, b, 100 * USDC);
    return { h, organizer, A, B, a, b };
  }

  it("withdrawing A cannot drain B's vault", async () => {
    const { h, A, B } = await twoCampaigns(100); // both Succeeded
    await expectError(withdraw(h, A.campaign, h.wallet(), { vault: B.vault }), "ConstraintTokenOwner");
    assert.equal(h.tokenBalance(B.vault), BigInt(100 * USDC));
  });

  it("refunding A cannot drain B's vault, nor use B's receipt", async () => {
    const { h, A, B, a, b } = await twoCampaigns(1000); // both will fail
    h.warp(3600);
    await expectError(refund(h, A.campaign, a, { vault: B.vault }), "ConstraintTokenOwner");
    // b's receipt belongs to B; claiming it against A is refused.
    await expectError(refund(h, A.campaign, b, { receiptOf: b.publicKey }), "AccountNotInitialized");
    assert.equal(h.tokenBalance(B.vault), BigInt(100 * USDC));
    assert.equal(h.tokenBalance(A.vault), BigInt(100 * USDC));
    assert.ok(h.exists(contributionPda(h, B.campaign, b.publicKey)), "b's receipt is untouched");
  });
});

describe("security: money is conserved", () => {
  it("success: the recipient receives exactly what contributors paid", async () => {
    const h = createHarness();
    const recipient = Keypair.generate().publicKey;
    const { campaign } = await createCampaign(h, { organizer: h.wallet(), recipient, goalUsdc: 200 });
    const contributors = people(h, 4);
    const paid = [30, 70, 55, 45]; // exactly the goal of 200
    for (const [i, c] of contributors.entries()) await contribute(h, campaign, c, paid[i] * USDC);
    await withdraw(h, campaign, h.wallet());

    const spent = contributors.reduce((sum, c) => sum + (BigInt(START_USDC * USDC) - balanceOf(h, c.publicKey)), 0n);
    assert.equal(spent, BigInt(200 * USDC));
    assert.equal(balanceOf(h, recipient), spent);
  });

  it("failure: vault balance tracks raised minus refunded at every step, ending at zero", async () => {
    const h = createHarness();
    const { campaign, vault } = await createCampaign(h, { organizer: h.wallet(), goalUsdc: 10_000 });
    const contributors = people(h, 3);
    for (const [i, c] of contributors.entries()) {
      await contribute(h, campaign, c, (i + 1) * 11 * USDC);
      await contribute(h, campaign, c, 3 * USDC); // top-ups too
    }
    h.warp(3600);
    const check = async () => {
      const s = await h.program.account.campaign.fetch(campaign);
      assert.equal(h.tokenBalance(vault), BigInt(s.totalRaised.sub(s.totalRefunded).toString()));
    };
    await check();
    for (const c of contributors) {
      await refund(h, campaign, c);
      await check();
    }
    assert.equal(h.tokenBalance(vault), 0n);
  });

  it("tokens sent straight to a vault are never paid out, and block closing it", async () => {
    // Success: the payout is exactly what was contributed; stray tokens stay.
    const h = createHarness();
    const organizer = h.wallet();
    const recipient = Keypair.generate().publicKey;
    const won = await createCampaign(h, { organizer, recipient, goalUsdc: 10 });
    const [a] = people(h, 1);
    await contribute(h, won.campaign, a, 10 * USDC);
    h.fundTokens(won.campaign, 15 * USDC); // overwrite the vault: 10 contributed + 5 sent directly
    await withdraw(h, won.campaign, h.wallet());
    assert.equal(balanceOf(h, recipient), BigInt(10 * USDC));
    assert.equal(h.tokenBalance(won.vault), BigInt(5 * USDC));

    // Failure: after every refund, stray tokens keep the vault non-empty, so
    // close_campaign is refused instead of the tokens being lost.
    const lost = await createCampaign(h, { organizer, goalUsdc: 1000 });
    await contribute(h, lost.campaign, a, 10 * USDC);
    h.fundTokens(lost.campaign, 12 * USDC); // 2 USDC sent directly
    h.warp(3600);
    await refund(h, lost.campaign, a);
    assert.equal(h.tokenBalance(lost.vault), BigInt(2 * USDC));
    await expectError(closeCampaign(h, lost.campaign, organizer), "Non-native account can only be closed if its balance is zero");
    assert.ok(h.exists(lost.campaign));
  });
});
