// CLAUDE.md: no admin keys. The program must not depend on any privileged
// third-party key -- in particular the removed KYC verifier.
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

import { anchor, createHarness } from "./harness";

describe("no admin keys", () => {
  it("lets a brand-new wallet open a public campaign with no verification", async () => {
    const h = createHarness();
    const { program } = h;
    const organizer = h.wallet();

    const id = new anchor.BN(1);
    const campaign = PublicKey.findProgramAddressSync(
      [Buffer.from("campaign"), organizer.publicKey.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
    await program.methods
      .createCampaign(id, "Open to anyone", new anchor.BN(1_000_000_000), new anchor.BN(h.now() + 3600),
        organizer.publicKey, null, 0, "", "")
      .accountsPartial({ organizer: organizer.publicKey, campaign, systemProgram: SystemProgram.programId })
      .signers([organizer])
      .rpc();

    const state = await program.account.campaign.fetch(campaign);
    assert.equal(state.invite, null, "a campaign with no invite is public");
  });

  it("has no verification instruction, account, constant or error left in the interface", () => {
    const { program } = createHarness();
    const idl = program.idl as any;
    // Lower-cased, since the IDL keeps error names in PascalCase but camelCases the rest.
    const names = (list: { name: string }[] | undefined) => (list ?? []).map((x) => x.name.toLowerCase());

    assert.notInclude(names(idl.instructions), "verifyidentity");
    assert.notInclude(names(idl.accounts), "verification");
    assert.notInclude(names(idl.constants), "kycverifier");
    assert.notInclude(names(idl.errors), "kycrequired");
    assert.notInclude(names(idl.errors), "notverifier");
    // create_campaign takes exactly organizer, campaign and the system program.
    const create = idl.instructions.find((i: any) => i.name === "createCampaign");
    assert.deepEqual(names(create.accounts), ["organizer", "campaign", "systemprogram"]);
  });
});
