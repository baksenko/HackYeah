// Step 4: contribute moves USDC into the campaign's vault with transfer_checked.
import { Keypair } from "@solana/web3.js";
import { assert } from "chai";

import { contribute, contributionPda, createCampaign, tokenAccountOf, updateRecipient, vaultOf } from "./fixtures";
import { createHarness, expectError, USDC } from "./harness";

/** A campaign with a funded contributor, ready to contribute. */
async function setup(goalUsdc = 100, contributorUsdc = 500) {
  const h = createHarness();
  const organizer = h.wallet();
  const { campaign, vault } = await createCampaign(h, { organizer, goalUsdc });
  const contributor = h.wallet();
  h.fundTokens(contributor.publicKey, contributorUsdc * USDC);
  return { h, organizer, campaign, vault, contributor, source: tokenAccountOf(contributor.publicKey) };
}

describe("contribute", () => {
  it("moves the exact amount into the vault and records it, with an event", async () => {
    const { h, campaign, vault, contributor, source } = await setup();

    await contribute(h, campaign, contributor, 40 * USDC, { nickname: "Kuba" });

    assert.equal(h.tokenBalance(vault), BigInt(40 * USDC));
    assert.equal(h.tokenBalance(source), BigInt(460 * USDC));
    const state = await h.program.account.campaign.fetch(campaign);
    assert.equal(state.totalRaised.toNumber(), 40 * USDC);
    assert.deepEqual(state.status, { active: {} });
    const receipt = await h.program.account.contribution.fetch(contributionPda(h, campaign, contributor.publicKey));
    assert.equal(receipt.amount.toNumber(), 40 * USDC);
    assert.equal(receipt.nickname, "Kuba");

    const [event] = h.events();
    assert.equal(event.name, "contributed");
    assert.equal(event.data.amount.toNumber(), 40 * USDC);
    assert.equal(event.data.contributorTotal.toNumber(), 40 * USDC);
    assert.equal(event.data.totalRaised.toNumber(), 40 * USDC);
    assert.equal(event.data.goalReached, false);
  });

  it("adds up top-ups and several contributors, keeping a nickname not re-supplied", async () => {
    const { h, campaign, vault, contributor } = await setup(1000);
    const other = h.wallet();
    h.fundTokens(other.publicKey, 100 * USDC);

    await contribute(h, campaign, contributor, 10 * USDC, { nickname: "Ania" });
    await contribute(h, campaign, contributor, 5 * USDC);
    await contribute(h, campaign, other, 20 * USDC);

    assert.equal(h.tokenBalance(vault), BigInt(35 * USDC));
    const receipt = await h.program.account.contribution.fetch(contributionPda(h, campaign, contributor.publicKey));
    assert.equal(receipt.amount.toNumber(), 15 * USDC);
    assert.equal(receipt.nickname, "Ania");
    assert.equal((await h.program.account.campaign.fetch(campaign)).totalRaised.toNumber(), 35 * USDC);
  });

  it("flips the campaign to Succeeded when the goal is reached, then refuses more", async () => {
    const { h, campaign, contributor } = await setup(100);

    await contribute(h, campaign, contributor, 60 * USDC);
    await contribute(h, campaign, contributor, 45 * USDC); // 105 >= 100

    const state = await h.program.account.campaign.fetch(campaign);
    assert.deepEqual(state.status, { succeeded: {} });
    assert.equal(h.events()[0].data.goalReached, true);
    await expectError(contribute(h, campaign, contributor, 1 * USDC), "CampaignNotActive");
  });

  it("refuses contributions after the deadline", async () => {
    const { h, campaign, contributor } = await setup();
    h.warp(3600);
    await expectError(contribute(h, campaign, contributor, 1 * USDC), "DeadlinePassed");
  });

  it("refuses a zero amount and more than the contributor holds", async () => {
    const { h, campaign, contributor, vault } = await setup(100, 10);
    await expectError(contribute(h, campaign, contributor, 0), "InvalidAmount");
    await expectError(contribute(h, campaign, contributor, 11 * USDC), "insufficient funds");
    assert.equal(h.tokenBalance(vault), 0n);
  });

  it("refuses any mint but the campaign's, from either side", async () => {
    const { h, campaign, contributor } = await setup();
    const fakeUsdc = h.createMint();
    h.fundTokens(contributor.publicKey, 100 * USDC, fakeUsdc);

    // Claiming a different mint for the whole transfer.
    await expectError(
      contribute(h, campaign, contributor, 10 * USDC, { mint: fakeUsdc, vault: vaultOf(campaign) }),
      "WrongMint"
    );
    // Paying from a token account of a different mint.
    await expectError(
      contribute(h, campaign, contributor, 10 * USDC, { contributorToken: tokenAccountOf(contributor.publicKey, fakeUsdc) }),
      "ConstraintTokenMint"
    );
  });

  it("refuses a fake vault, and nothing moves", async () => {
    const { h, campaign, contributor, source } = await setup();
    // Someone else's token account: caught by the owner check.
    const thiefsAccount = h.fundTokens(h.wallet().publicKey, 0);
    await expectError(contribute(h, campaign, contributor, 10 * USDC, { vault: thiefsAccount }), "ConstraintTokenOwner");
    // A token account that *is* owned by the campaign but is not its vault
    // (anyone can create one): caught by the associated-address check.
    const impostor = h.fundTokens(campaign, 0, undefined, Keypair.generate().publicKey);
    await expectError(contribute(h, campaign, contributor, 10 * USDC, { vault: impostor }), "ConstraintAssociated");

    assert.equal(h.tokenBalance(thiefsAccount), 0n);
    assert.equal(h.tokenBalance(impostor), 0n);
    assert.equal(h.tokenBalance(source), BigInt(500 * USDC));
  });

  it("refuses to pull from someone else's token account", async () => {
    const { h, campaign, contributor } = await setup();
    const victim = h.wallet();
    const victimsAccount = h.fundTokens(victim.publicKey, 100 * USDC);
    await expectError(
      contribute(h, campaign, contributor, 10 * USDC, { contributorToken: victimsAccount }),
      "ConstraintTokenOwner"
    );
    assert.equal(h.tokenBalance(victimsAccount), BigInt(100 * USDC));
  });

  it("refuses when the recipient changed since the contributor looked", async () => {
    const { h, organizer, campaign, contributor } = await setup();
    const sawRecipient = organizer.publicKey;
    await updateRecipient(h, campaign, organizer, Keypair.generate().publicKey);
    await expectError(
      contribute(h, campaign, contributor, 10 * USDC, { expectedRecipient: sawRecipient }),
      "RecipientChanged"
    );
  });

  it("refuses an over-long nickname", async () => {
    const { h, campaign, contributor } = await setup();
    await expectError(contribute(h, campaign, contributor, 1 * USDC, { nickname: "x".repeat(33) }), "NicknameTooLong");
  });

  it("private campaign: needs the matching invite to co-sign", async () => {
    const h = createHarness();
    const invite = Keypair.generate();
    const { campaign, vault } = await createCampaign(h, { organizer: h.wallet(), invite: invite.publicKey });
    const contributor = h.wallet();
    h.fundTokens(contributor.publicKey, 50 * USDC);

    await expectError(contribute(h, campaign, contributor, 5 * USDC), "InviteRequired");
    await expectError(contribute(h, campaign, contributor, 5 * USDC, { invite: Keypair.generate() }), "InvalidInvite");
    await contribute(h, campaign, contributor, 5 * USDC, { invite });
    assert.equal(h.tokenBalance(vault), BigInt(5 * USDC));
  });
});
