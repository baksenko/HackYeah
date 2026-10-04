// Ported from the old validator suite: create_campaign's input limits.
import { Keypair } from "@solana/web3.js";
import { assert } from "chai";

import { campaignPda, createCampaign } from "./fixtures";
import { anchor, createHarness, expectError } from "./harness";

describe("create_campaign input limits", () => {
  it("stores a description, image link and up to 5 tags", async () => {
    const h = createHarness();
    const description = "Swings and a sandpit for the kids on our street.\nEvery zloty goes to the playground fund.";
    const imageUrl = "https://example.org/playground.jpg";
    const { campaign } = await createCampaign(h, { organizer: h.wallet(), description, imageUrl, tags: 0b11111 });
    const s = await h.program.account.campaign.fetch(campaign);
    assert.equal(s.description, description);
    assert.equal(s.imageUrl, imageUrl);
    assert.equal(s.tags, 0b11111);
  });

  /** Every create_campaign field at its byte maximum. */
  const maxed = {
    title: "t".repeat(64),
    description: "d".repeat(300),
    imageUrl: "https://example.org/" + "a".repeat(200 - "https://example.org/".length),
    tags: 0b11111,
    reference: Keypair.generate().publicKey,
    memo: "m".repeat(64),
  };

  it("fits a maximum-size public and private campaign in one transaction", async () => {
    // Sent the way a real wallet sends it: the organizer pays the fee, so it
    // is the only signer. (The harness's own fee payer would add a second
    // signature that no real user has.)
    const h = createHarness();
    for (const invite of [null, Keypair.generate().publicKey]) {
      const organizer = h.wallet();
      const id = new anchor.BN(500 + (invite ? 1 : 0));
      const campaign = campaignPda(h, organizer.publicKey, id);
      const tx = await h.program.methods
        .createCampaign(id, maxed.title, new anchor.BN(1), new anchor.BN(h.now() + 3600), organizer.publicKey,
          invite, maxed.tags, maxed.description, maxed.imageUrl, maxed.reference, maxed.memo)
        .accountsPartial({ organizer: organizer.publicKey, campaign })
        .transaction();
      tx.feePayer = organizer.publicKey;
      await h.provider.sendAndConfirm(tx, [organizer]);
      const s = await h.program.account.campaign.fetch(campaign);
      assert.equal(s.title.length, 64);
      assert.equal(s.description.length, 300);
      assert.equal(s.imageUrl.length, 200);
      assert.equal(s.memo.length, 64);
    }
  });

  it("leaves headroom under the 1232-byte limit for instructions a wallet may add", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    const id = new anchor.BN(999);
    const campaign = campaignPda(h, organizer.publicKey, id);
    const tx = await h.program.methods
      .createCampaign(id, maxed.title, new anchor.BN(1), new anchor.BN(h.now() + 3600), organizer.publicKey,
        Keypair.generate().publicKey, maxed.tags, maxed.description, maxed.imageUrl, maxed.reference, maxed.memo)
      .accountsPartial({ organizer: organizer.publicKey, campaign })
      .transaction();
    tx.feePayer = organizer.publicKey;
    tx.recentBlockhash = String(h.svm.latestBlockhash());
    const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    assert.isAtMost(size, 1232 - 80, `worst-case create_campaign is ${size} bytes`);
  });

  it("rejects a title, description or image link over its byte limit", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    await expectError(createCampaign(h, { organizer, title: "t".repeat(65) }), "TitleTooLong");
    // 151 two-byte letters = 302 bytes: limits count bytes, not letters.
    await expectError(createCampaign(h, { organizer, description: "ą".repeat(151) }), "DescriptionTooLong");
    await expectError(
      createCampaign(h, { organizer, imageUrl: "https://example.org/" + "a".repeat(181) }),
      "ImageUrlTooLong"
    );
  });

  it("rejects image links that are not https", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    await expectError(createCampaign(h, { organizer, imageUrl: "http://example.org/cat.jpg" }), "InvalidImageUrl");
    await expectError(createCampaign(h, { organizer, imageUrl: "javascript:alert(1)" }), "InvalidImageUrl");
  });

  it("rejects a sixth tag", async () => {
    const h = createHarness();
    await expectError(createCampaign(h, { organizer: h.wallet(), tags: 0b111111 }), "TooManyTags");
  });
});
