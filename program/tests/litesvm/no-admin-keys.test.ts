// CLAUDE.md: no admin keys. The program must not depend on any privileged
// third-party key -- in particular the removed KYC verifier.
import { assert } from "chai";

import { createCampaign } from "./fixtures";
import { createHarness } from "./harness";

describe("no admin keys", () => {
  it("lets a brand-new wallet open a public campaign with no verification", async () => {
    const h = createHarness();
    const { campaign } = await createCampaign(h, { organizer: h.wallet() });
    const state = await h.program.account.campaign.fetch(campaign);
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
    const create = idl.instructions.find((i: any) => i.name === "createCampaign");
    assert.notInclude(names(create.accounts), "verification");
  });
});
