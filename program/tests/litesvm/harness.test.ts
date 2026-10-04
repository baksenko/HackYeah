// Proves the LiteSVM harness itself: the program loads, time travel works
// without sleeping, named program errors come through, and the test USDC mint
// sits at the address the localnet build expects.
import { Keypair } from "@solana/web3.js";
import { assert } from "chai";

import { contribute, createCampaign } from "./fixtures";
import { createHarness, expectError, TEST_USDC_MINT, USDC, USDC_DECIMALS } from "./harness";

describe("litesvm harness", () => {
  it("moves the clock a week forward without waiting", () => {
    const h = createHarness();
    const before = h.now();
    const started = Date.now();
    h.warp(7 * 24 * 3600);
    assert.equal(h.now(), before + 7 * 24 * 3600);
    assert.isBelow(Date.now() - started, 1000, "a week of chain time should take no real time");
  });

  it("exports the localnet USDC mint to the IDL, matching the test mint", () => {
    const h = createHarness();
    const mint = h.program.idl.constants?.find((c) => c.name === "usdcMint");
    assert.ok(mint, "USDC_MINT should be exported to the IDL");
    assert.equal(String(mint!.value), TEST_USDC_MINT.toBase58());
    const decimals = h.program.idl.constants?.find((c) => c.name === "usdcDecimals");
    assert.equal(Number(decimals!.value), USDC_DECIMALS);
  });

  it("creates the test USDC mint and funds token accounts", () => {
    const h = createHarness();
    assert.ok(h.exists(TEST_USDC_MINT));
    const alice = h.wallet();
    const ata = h.fundTokens(alice.publicKey, 25 * USDC);
    assert.equal(h.tokenBalance(ata), BigInt(25 * USDC));
  });

  it("surfaces a named program error after a time jump", async () => {
    const h = createHarness();
    const organizer = h.wallet();
    // Private, so this smoke test does not depend on public-campaign rules.
    const invite = Keypair.generate();
    const { campaign } = await createCampaign(h, { organizer, invite: invite.publicKey });

    const contributor = h.wallet();
    h.fundTokens(contributor.publicKey, 10 * USDC);
    await contribute(h, campaign, contributor, 1 * USDC, { invite });
    h.warp(3601);
    await expectError(contribute(h, campaign, contributor, 1 * USDC, { invite }), "DeadlinePassed");
  });
});
