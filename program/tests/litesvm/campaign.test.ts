// Step 3: the USDC campaign account, its vault, and update_recipient.
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

import { contribute, createCampaign, updateRecipient } from "./fixtures";
import { anchor, createHarness, expectError, TEST_USDC_MINT, USDC } from "./harness";
import { readAccount } from "./provider";

const { bs58 } = anchor.utils.bytes;

describe("create_campaign", () => {
  it("records the mint, starts Active, and opens an empty vault owned by the campaign", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const recipient = Keypair.generate().publicKey;
    const { campaign, vault, deadline } = await createCampaign(h, { organizer, recipient, goalUsdc: 250 });

    const state = await h.program.account.campaign.fetch(campaign);
    assert.ok(state.mint.equals(TEST_USDC_MINT));
    assert.deepEqual(state.status, { active: {} });
    assert.equal(state.goal.toNumber(), 250 * USDC);
    assert.ok(state.recipient.equals(recipient));

    const info = readAccount(h.svm, vault)!;
    assert.ok(info, "vault exists");
    assert.ok(info.owner.equals(TOKEN_PROGRAM_ID));
    const token = AccountLayout.decode(info.data);
    assert.ok(token.mint.equals(TEST_USDC_MINT));
    assert.ok(token.owner.equals(campaign), "only the campaign PDA can move the vault");
    assert.equal(token.amount, 0n);

    const [event] = h.events();
    assert.equal(event.name, "campaignCreated");
    assert.ok(event.data.campaign.equals(campaign));
    assert.ok(event.data.mint.equals(TEST_USDC_MINT));
    assert.equal(event.data.goal.toNumber(), 250 * USDC);
    assert.equal(event.data.deadline.toNumber(), deadline);
    assert.equal(event.data.private, false);
  });

  it("refuses any mint other than the configured USDC", async () => {
    const h = createHarness();
    const fakeUsdc = h.createMint(); // same decimals, different address
    await expectError(createCampaign(h, { organizer: h.wallet(), mint: fakeUsdc }), "WrongMint");
  });

  it("refuses a vault that is not the campaign's own token account", async () => {
    // The vault is created through the Associated Token program, which only
    // ever creates the canonical address; handed anything else it aborts the
    // whole transaction (MissingAccount), so no campaign comes into being.
    const h = createHarness();
    const organizer = h.wallet();
    const organizersOwnAta = h.fundTokens(organizer.publicKey, 0);
    const randomAccount = Keypair.generate().publicKey;
    for (const vault of [organizersOwnAta, randomAccount]) {
      await expectError(createCampaign(h, { organizer, vault }), "MissingAccount");
    }
    assert.equal(h.tokenBalance(organizersOwnAta), 0n, "the organizer's account is untouched");
    assert.isFalse(h.exists(randomAccount), "nothing was created at the fake address");
    assert.equal((await h.program.account.campaign.all()).length, 0, "no campaign was created");
  });

  it("validates goal, deadline and recipient", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    await expectError(createCampaign(h, { organizer, goalUsdc: 0 }), "InvalidGoal");
    await expectError(createCampaign(h, { organizer, secondsFromNow: -1 }), "InvalidDeadline");
    await expectError(createCampaign(h, { organizer, recipient: PublicKey.default }), "InvalidRecipient");
  });

  it("puts status and mint at the documented offsets for memcmp filters", async () => {
    const h = createHarness();
    const { campaign } = await createCampaign(h, { organizer: h.wallet() });
    await createCampaign(h, { organizer: h.wallet() });

    const byStatus = await h.program.account.campaign.all([{ memcmp: { offset: 112, bytes: bs58.encode([0]) } }]);
    assert.equal(byStatus.length, 2, "both campaigns are Active (variant 0) at offset 112");
    const byMint = await h.program.account.campaign.all([{ memcmp: { offset: 72, bytes: TEST_USDC_MINT.toBase58() } }]);
    assert.equal(byMint.length, 2);
    assert.ok(byStatus.some((a) => a.publicKey.equals(campaign)));
  });
});

describe("update_recipient", () => {
  it("lets the organizer fix the recipient before anyone contributes, and emits an event", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const { campaign } = await createCampaign(h, { organizer });
    const fixed = Keypair.generate().publicKey;

    await updateRecipient(h, campaign, organizer, fixed);

    assert.ok((await h.program.account.campaign.fetch(campaign)).recipient.equals(fixed));
    const [event] = h.events();
    assert.equal(event.name, "recipientUpdated");
    assert.ok(event.data.oldRecipient.equals(organizer.publicKey));
    assert.ok(event.data.newRecipient.equals(fixed));
  });

  it("refuses anyone but the organizer", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const { campaign } = await createCampaign(h, { organizer });
    const stranger = h.wallet();
    await expectError(updateRecipient(h, campaign, stranger, stranger.publicKey), "NotOrganizer");
  });

  it("is locked by the first contribution", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const { campaign } = await createCampaign(h, { organizer });
    const contributor = h.wallet();
    h.fundTokens(contributor.publicKey, 5 * USDC);
    await contribute(h, campaign, contributor, 1 * USDC);
    await expectError(updateRecipient(h, campaign, organizer, Keypair.generate().publicKey), "RecipientLocked");
  });

  it("refuses an empty recipient", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const { campaign } = await createCampaign(h, { organizer });
    await expectError(updateRecipient(h, campaign, organizer, PublicKey.default), "InvalidRecipient");
  });
});
