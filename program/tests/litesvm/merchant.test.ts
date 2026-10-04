// Shop payments: the Solana Pay reference and memo stored on the campaign,
// the reference required on every payout, and contributions capped at the
// goal so the shop is paid exactly what it asked for.
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

import { contribute, createCampaign, tokenAccountOf, updateRecipient, withdraw } from "./fixtures";
import { createHarness, expectError, Harness, USDC } from "./harness";

/** A shop campaign: goal 50 USDC, a reference and a memo, two funded friends. */
async function shopCampaign() {
  const h = createHarness();
  const organizer = h.wallet();
  const shop = Keypair.generate().publicKey; // has no USDC account yet
  const reference = Keypair.generate().publicKey;
  const { campaign, vault } = await createCampaign(h, {
    organizer,
    recipient: shop,
    goalUsdc: 50,
    reference,
    memo: "order-1042",
  });
  const friends = [h.wallet(), h.wallet()];
  for (const f of friends) h.fundTokens(f.publicKey, 100 * USDC);
  return { h, organizer, shop, reference, campaign, vault, friends };
}

const statusOf = async (h: Harness, campaign: PublicKey) =>
  Object.keys((await h.program.account.campaign.fetch(campaign)).status)[0];

describe("shop payments (Solana Pay reference and memo)", () => {
  it("stores the reference and memo on the campaign", async () => {
    const { h, campaign, reference } = await shopCampaign();
    const state = await h.program.account.campaign.fetch(campaign);
    assert.ok(state.reference!.equals(reference));
    assert.equal(state.memo, "order-1042");
  });

  it("a random wallet's payout carries the reference and pays the shop exactly the goal", async () => {
    const { h, shop, reference, campaign, vault, friends } = await shopCampaign();
    await contribute(h, campaign, friends[0], 30 * USDC);
    await contribute(h, campaign, friends[1], 20 * USDC); // exactly the rest
    assert.equal(await statusOf(h, campaign), "succeeded");

    await withdraw(h, campaign, h.wallet()); // fixture passes the stored reference
    const [event] = h.events();
    assert.equal(event.name, "withdrawn");
    assert.ok(event.data.reference.equals(reference));
    assert.equal(h.tokenBalance(tokenAccountOf(shop)), BigInt(50 * USDC));
    assert.equal(h.tokenBalance(vault), 0n);
  });

  it("refuses a payout without the reference, or with a different one", async () => {
    const { h, campaign, vault, friends } = await shopCampaign();
    await contribute(h, campaign, friends[0], 50 * USDC);
    await expectError(withdraw(h, campaign, h.wallet(), { reference: null }), "ReferenceRequired");
    await expectError(
      withdraw(h, campaign, h.wallet(), { reference: Keypair.generate().publicKey }),
      "WrongReference"
    );
    assert.equal(h.tokenBalance(vault), BigInt(50 * USDC), "nothing left the vault");
  });

  it("refuses a contribution over the remaining amount, and says how much remains", async () => {
    const { h, campaign, friends } = await shopCampaign();
    await contribute(h, campaign, friends[0], 30 * USDC);
    try {
      await contribute(h, campaign, friends[1], 25 * USDC); // 20 remain
      assert.fail("expected ExceedsGoal");
    } catch (e: any) {
      const text = [e.error?.errorCode?.code, e.message, ...(e.logs ?? e.transactionLogs ?? [])].join(" ");
      assert.include(text, "ExceedsGoal");
      assert.include(text, `Only ${20 * USDC} base units are still needed`);
    }
    assert.equal((await h.program.account.campaign.fetch(campaign)).totalRaised.toNumber(), 30 * USDC);
  });

  it("an exact final contribution flips the campaign to Succeeded", async () => {
    const { h, campaign, friends } = await shopCampaign();
    await contribute(h, campaign, friends[0], 49 * USDC);
    assert.equal(await statusOf(h, campaign), "active");
    await contribute(h, campaign, friends[1], 1 * USDC);
    assert.equal(await statusOf(h, campaign), "succeeded");
    assert.equal(h.events()[0].data.goalReached, true);
  });

  it("pays exactly the goal even when USDC was sent straight to the vault", async () => {
    const { h, shop, campaign, vault, friends } = await shopCampaign();
    await contribute(h, campaign, friends[0], 50 * USDC);
    h.fundTokens(campaign, 57 * USDC); // the vault now holds 7 USDC that is not a contribution
    await withdraw(h, campaign, h.wallet());
    assert.equal(h.tokenBalance(tokenAccountOf(shop)), BigInt(50 * USDC));
    assert.equal(h.tokenBalance(vault), BigInt(7 * USDC), "stray tokens stay in the vault");
  });

  it("changes reference and memo only together with the recipient, before any contribution", async () => {
    const { h, organizer, campaign, friends } = await shopCampaign();
    const newShop = Keypair.generate().publicKey;
    const newReference = Keypair.generate().publicKey;
    await updateRecipient(h, campaign, organizer, newShop, { reference: newReference, memo: "order-1043" });
    let state = await h.program.account.campaign.fetch(campaign);
    assert.ok(state.recipient.equals(newShop));
    assert.ok(state.reference!.equals(newReference));
    assert.equal(state.memo, "order-1043");
    const [event] = h.events();
    assert.ok(event.data.reference.equals(newReference));

    await contribute(h, campaign, friends[0], 10 * USDC);
    await expectError(
      updateRecipient(h, campaign, organizer, newShop, { reference: Keypair.generate().publicKey, memo: "x" }),
      "RecipientLocked"
    );
    state = await h.program.account.campaign.fetch(campaign);
    assert.ok(state.reference!.equals(newReference), "the reference is locked too");
  });

  it("rejects a memo over 64 bytes, at creation and on update", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    await expectError(createCampaign(h, { organizer, memo: "m".repeat(65) }), "MemoTooLong");
    const { campaign } = await createCampaign(h, { organizer });
    await expectError(updateRecipient(h, campaign, organizer, organizer.publicKey, { memo: "m".repeat(65) }), "MemoTooLong");
  });

  it("campaigns without a reference pay out with or without one passed", async () => {
    const h = createHarness();
    const recipient = Keypair.generate().publicKey;
    const { campaign } = await createCampaign(h, { organizer: h.wallet(), recipient, goalUsdc: 10 });
    const friend = h.wallet();
    h.fundTokens(friend.publicKey, 10 * USDC);
    await contribute(h, campaign, friend, 10 * USDC);
    await withdraw(h, campaign, h.wallet(), { reference: Keypair.generate().publicKey });
    assert.equal(h.tokenBalance(tokenAccountOf(recipient)), BigInt(10 * USDC));
  });
});
