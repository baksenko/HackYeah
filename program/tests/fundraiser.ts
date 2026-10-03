import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { createHash } from "crypto";
import { Fundraiser } from "../target/types/fundraiser";

const CAMPAIGN_SEED = Buffer.from("campaign");
const CONTRIBUTION_SEED = Buffer.from("contribution");
const VERIFICATION_SEED = Buffer.from("verification");

/** The demo KYC verifier: derived from a public seed, see constants.rs. */
const DEMO_VERIFIER = Keypair.fromSeed(
  createHash("sha256").update("chip-in:demo-kyc-verifier:v1").digest()
);

/** Deadlines in these tests are a few seconds out, so the suite really waits. */
const DEADLINE_SECS = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("fundraiser", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.fundraiser as Program<Fundraiser>;

  /** Monotonic ids so each test gets a fresh PDA. */
  let nextId = 0;
  const freshId = () => new anchor.BN(++nextId);

  const campaignPda = (organizer: PublicKey, id: anchor.BN) =>
    PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, organizer.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];

  const contributionPda = (campaign: PublicKey, contributor: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [CONTRIBUTION_SEED, campaign.toBuffer(), contributor.toBuffer()],
      program.programId
    )[0];

  const verificationPda = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([VERIFICATION_SEED, wallet.toBuffer()], program.programId)[0];

  /** Wallets already verified in this run, so each is verified only once. */
  const verified = new Set<string>();

  function verifyIdentity(wallet: Keypair, verifier: Keypair = DEMO_VERIFIER) {
    return program.methods
      .verifyIdentity()
      .accountsPartial({
        wallet: wallet.publicKey,
        verifier: verifier.publicKey,
        verification: verificationPda(wallet.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet, verifier])
      .rpc();
  }

  /** A funded wallet on the local validator. */
  async function wallet(sol = 10): Promise<Keypair> {
    const kp = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    const bh = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    return kp;
  }

  /** Chain time, which is what the program compares deadlines against. */
  async function chainNow(): Promise<number> {
    const slot = await provider.connection.getSlot();
    return (await provider.connection.getBlockTime(slot))!;
  }

  async function createCampaign(opts: {
    organizer: Keypair;
    recipient?: PublicKey;
    goalSol: number;
    secondsFromNow?: number;
    title?: string;
    /** Makes the campaign private, gated on this key. */
    invite?: PublicKey;
    tags?: number;
    description?: string;
    imageUrl?: string;
    /**
     * Whose verification to pass. Defaults to the organizer's own for a
     * public campaign (verifying them first if needed) and none for a private
     * one; `null` passes none.
     */
    verificationOf?: PublicKey | null;
  }) {
    const isPublic = !opts.invite;
    if (isPublic && opts.verificationOf === undefined && !verified.has(opts.organizer.publicKey.toBase58())) {
      await verifyIdentity(opts.organizer);
      verified.add(opts.organizer.publicKey.toBase58());
    }
    const verificationOf =
      opts.verificationOf === undefined ? (isPublic ? opts.organizer.publicKey : null) : opts.verificationOf;
    const id = freshId();
    const campaign = campaignPda(opts.organizer.publicKey, id);
    const deadline = (await chainNow()) + (opts.secondsFromNow ?? DEADLINE_SECS);
    await program.methods
      .createCampaign(
        id,
        opts.title ?? "Test campaign",
        new anchor.BN(opts.goalSol * LAMPORTS_PER_SOL),
        new anchor.BN(deadline),
        opts.recipient ?? opts.organizer.publicKey,
        opts.invite ?? null,
        opts.tags ?? 0,
        opts.description ?? "",
        opts.imageUrl ?? ""
      )
      .accountsPartial({
        organizer: opts.organizer.publicKey,
        campaign,
        verification: verificationOf ? verificationPda(verificationOf) : null,
        systemProgram: SystemProgram.programId,
      })
      .signers([opts.organizer])
      .rpc();
    return { id, campaign, deadline };
  }

  function contribute(
    campaign: PublicKey,
    contributor: Keypair,
    sol: number,
    opts: { nickname?: string; invite?: Keypair } = {}
  ) {
    return program.methods
      .contribute(new anchor.BN(sol * LAMPORTS_PER_SOL), opts.nickname ?? "")
      .accountsPartial({
        contributor: contributor.publicKey,
        campaign,
        contribution: contributionPda(campaign, contributor.publicKey),
        invite: opts.invite?.publicKey ?? null,
        systemProgram: SystemProgram.programId,
      })
      .signers(opts.invite ? [contributor, opts.invite] : [contributor])
      .rpc();
  }

  const withdraw = (campaign: PublicKey, recipient: Keypair) =>
    program.methods
      .withdraw()
      .accountsPartial({ recipient: recipient.publicKey, campaign })
      .signers([recipient])
      .rpc();

  const refund = (campaign: PublicKey, contributor: Keypair) =>
    program.methods
      .refund()
      .accountsPartial({
        contributor: contributor.publicKey,
        campaign,
        contribution: contributionPda(campaign, contributor.publicKey),
      })
      .signers([contributor])
      .rpc();

  /** Waits until chain time is past `deadline`. */
  async function waitForDeadline(deadline: number) {
    for (let i = 0; i < 60; i++) {
      if ((await chainNow()) >= deadline) return;
      await sleep(1000);
    }
    throw new Error("chain clock never passed the deadline");
  }

  /** Asserts the program rejected the tx with a specific named error. */
  async function expectError(p: Promise<unknown>, name: string) {
    try {
      await p;
      assert.fail(`expected the program to reject this with ${name}, but it succeeded`);
    } catch (e: any) {
      const text = (e.error?.errorCode?.code ?? "") + " " + (e.message ?? "") + " " + JSON.stringify(e.logs ?? []);
      assert.include(text, name, `expected ${name}, got: ${text.slice(0, 500)}`);
    }
  }

  // ---------------------------------------------------------------- happy path

  it("success path: two contributions reach the goal, then the recipient withdraws", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const carol = await wallet();

    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 1 });

    await contribute(campaign, bob, 0.6);
    await contribute(campaign, carol, 0.5);

    let state = await program.account.campaign.fetch(campaign);
    assert.equal(state.totalRaised.toNumber(), 1.1 * LAMPORTS_PER_SOL, "both contributions counted");
    assert.isFalse(state.withdrawn);

    await waitForDeadline(deadline);

    const before = await provider.connection.getBalance(organizer.publicKey);
    await withdraw(campaign, organizer);
    const after = await provider.connection.getBalance(organizer.publicKey);

    state = await program.account.campaign.fetch(campaign);
    assert.isTrue(state.withdrawn, "campaign is marked withdrawn");
    assert.isAbove(after - before, 1.09 * LAMPORTS_PER_SOL, "recipient received the pot");

    // The rent reserve stayed behind; the pot itself is gone.
    const left = await provider.connection.getBalance(campaign);
    assert.isBelow(left, 0.01 * LAMPORTS_PER_SOL, "only the rent reserve remains");
  });

  it("failure path: the goal is missed, so the contributor reclaims exactly what they paid", async () => {
    const organizer = await wallet();
    const bob = await wallet();

    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 5 });
    await contribute(campaign, bob, 0.3);

    await waitForDeadline(deadline);

    const before = await provider.connection.getBalance(bob.publicKey);
    await refund(campaign, bob);
    const after = await provider.connection.getBalance(bob.publicKey);

    // 0.3 SOL back, plus the returned rent of the closed Contribution account,
    // minus the transaction fee.
    assert.isAbove(after - before, 0.3 * LAMPORTS_PER_SOL, "got at least the contribution back");

    const state = await program.account.campaign.fetch(campaign);
    assert.equal(state.totalRefunded.toNumber(), 0.3 * LAMPORTS_PER_SOL);

    const receipt = await provider.connection.getAccountInfo(contributionPda(campaign, bob.publicKey));
    assert.isNull(receipt, "the Contribution receipt was closed");
  });

  // ---------------------------------------------------------------- rejections

  it("rejects withdraw before the deadline", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign } = await createCampaign({ organizer, goalSol: 1, secondsFromNow: 120 });
    await contribute(campaign, bob, 1.5); // goal already exceeded, but time is not up

    await expectError(withdraw(campaign, organizer), "DeadlineNotReached");
  });

  it("rejects withdraw by anyone who is not the recipient", async () => {
    const organizer = await wallet();
    const recipient = await wallet();
    const mallory = await wallet();

    const { campaign, deadline } = await createCampaign({
      organizer,
      recipient: recipient.publicKey,
      goalSol: 1,
    });
    await contribute(campaign, mallory, 1);
    await waitForDeadline(deadline);

    // Even the organizer, who created the campaign, has no claim on the money.
    await expectError(withdraw(campaign, organizer), "NotRecipient");
    await expectError(withdraw(campaign, mallory), "NotRecipient");

    // The named recipient still can.
    await withdraw(campaign, recipient);
  });

  it("rejects withdraw when the goal was missed", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 5 });
    await contribute(campaign, bob, 0.3);
    await waitForDeadline(deadline);

    await expectError(withdraw(campaign, organizer), "GoalNotReached");
  });

  it("rejects refund when the goal was reached", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 1 });
    await contribute(campaign, bob, 1);
    await waitForDeadline(deadline);

    await expectError(refund(campaign, bob), "GoalReached");
  });

  it("rejects a second refund", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 5 });
    await contribute(campaign, bob, 0.4);
    await waitForDeadline(deadline);

    await refund(campaign, bob);
    // The receipt no longer exists, so there is nothing left to refund against.
    await expectError(refund(campaign, bob), "AccountNotInitialized");
  });

  it("rejects contribute after the deadline", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign, deadline } = await createCampaign({ organizer, goalSol: 1 });
    await waitForDeadline(deadline);

    await expectError(contribute(campaign, bob, 0.5), "DeadlinePassed");
  });

  // ------------------------------------------------- private campaigns & names

  it("private campaign: rejects a contribution without the invite", async () => {
    const organizer = await wallet();
    const stranger = await wallet();
    const invite = Keypair.generate();
    const { campaign } = await createCampaign({
      organizer, goalSol: 1, secondsFromNow: 120, invite: invite.publicKey,
    });

    await expectError(contribute(campaign, stranger, 0.1), "InviteRequired");
  });

  it("private campaign: rejects an invite from a different campaign", async () => {
    const organizer = await wallet();
    const stranger = await wallet();
    const invite = Keypair.generate();
    const { campaign } = await createCampaign({
      organizer, goalSol: 1, secondsFromNow: 120, invite: invite.publicKey,
    });

    await expectError(
      contribute(campaign, stranger, 0.1, { invite: Keypair.generate() }),
      "InvalidInvite"
    );
  });

  it("private campaign: accepts a contribution from someone holding the invite", async () => {
    const organizer = await wallet();
    const friend = await wallet();
    const invite = Keypair.generate();
    const { campaign } = await createCampaign({
      organizer, goalSol: 1, secondsFromNow: 120, invite: invite.publicKey,
    });

    await contribute(campaign, friend, 0.2, { invite, nickname: "Kuba" });
    const receipt = await program.account.contribution.fetch(
      contributionPda(campaign, friend.publicKey)
    );
    assert.equal(receipt.amount.toNumber(), 0.2 * LAMPORTS_PER_SOL);
    assert.equal(receipt.nickname, "Kuba");
  });

  it("keeps a contributor's nickname on a top-up that does not give a new one", async () => {
    const organizer = await wallet();
    const bob = await wallet();
    const { campaign } = await createCampaign({ organizer, goalSol: 5, secondsFromNow: 120 });

    await contribute(campaign, bob, 0.1, { nickname: "Bob" });
    await contribute(campaign, bob, 0.1);
    const receipt = await program.account.contribution.fetch(contributionPda(campaign, bob.publicKey));
    assert.equal(receipt.nickname, "Bob");
    assert.equal(receipt.amount.toNumber(), 0.2 * LAMPORTS_PER_SOL);

    await expectError(contribute(campaign, bob, 0.1, { nickname: "x".repeat(33) }), "NicknameTooLong");
  });

  it("stores up to 5 tags and rejects a sixth", async () => {
    const organizer = await wallet();
    const tags = 0b10110; // three tags
    const { campaign } = await createCampaign({ organizer, goalSol: 1, secondsFromNow: 120, tags });
    const state = await program.account.campaign.fetch(campaign);
    assert.equal(state.tags, tags);

    await expectError(
      createCampaign({ organizer, goalSol: 1, secondsFromNow: 120, tags: 0b111111 }),
      "TooManyTags"
    );
  });

  it("public campaign: rejects an organizer without a verified identity", async () => {
    const organizer = await wallet();
    await expectError(createCampaign({ organizer, goalSol: 1, verificationOf: null }), "KycRequired");
  });

  it("rejects a verification signed by anyone but the KYC verifier", async () => {
    const someone = await wallet();
    const fakeVerifier = Keypair.generate();
    await expectError(verifyIdentity(someone, fakeVerifier), "NotVerifier");
  });

  it("public campaign: rejects borrowing another wallet's verification", async () => {
    const verifiedOne = await wallet();
    await verifyIdentity(verifiedOne);
    const organizer = await wallet();
    await expectError(
      createCampaign({ organizer, goalSol: 1, verificationOf: verifiedOne.publicKey }),
      "ConstraintSeeds"
    );
  });

  it("verified organizer can open a public campaign; private ones need no verification", async () => {
    const organizer = await wallet();
    await verifyIdentity(organizer);
    const record = await program.account.verification.fetch(verificationPda(organizer.publicKey));
    assert.ok(record.wallet.equals(organizer.publicKey));
    const { campaign } = await createCampaign({ organizer, goalSol: 1, verificationOf: organizer.publicKey });
    assert.equal((await program.account.campaign.fetch(campaign)).invite, null);

    const friend = await wallet();
    const invite = Keypair.generate();
    const priv = await createCampaign({ organizer: friend, goalSol: 1, invite: invite.publicKey });
    assert.ok((await program.account.campaign.fetch(priv.campaign)).invite!.equals(invite.publicKey));
  });

  it("stores a description and an image link, fixed at creation", async () => {
    const organizer = await wallet();
    const description =
      "Swings and a sandpit for the kids on our street.\nEvery zloty goes to the council's playground fund.";
    const imageUrl = "https://example.org/playground.jpg";
    const { campaign } = await createCampaign({ organizer, goalSol: 1, description, imageUrl });
    const state = await program.account.campaign.fetch(campaign);
    assert.equal(state.description, description);
    assert.equal(state.imageUrl, imageUrl);
  });

  it("fits a maximum-length title, description and link in one transaction", async () => {
    const organizer = await wallet();
    const imageUrl = "https://example.org/" + "a".repeat(200 - "https://example.org/".length);
    const { campaign } = await createCampaign({
      organizer,
      goalSol: 1,
      title: "t".repeat(64),
      description: "d".repeat(500),
      imageUrl,
      tags: 0b11111,
    });
    const state = await program.account.campaign.fetch(campaign);
    assert.equal(state.description.length, 500);
    assert.equal(state.imageUrl.length, 200);
  });

  it("rejects a description over 500 bytes", async () => {
    const organizer = await wallet();
    // 251 two-byte characters = 502 bytes: the limit counts bytes, not letters.
    await expectError(
      createCampaign({ organizer, goalSol: 1, description: "ą".repeat(251) }),
      "DescriptionTooLong"
    );
  });

  it("rejects an image link that is not https", async () => {
    const organizer = await wallet();
    await expectError(
      createCampaign({ organizer, goalSol: 1, imageUrl: "http://example.org/cat.jpg" }),
      "InvalidImageUrl"
    );
    await expectError(
      createCampaign({ organizer, goalSol: 1, imageUrl: "javascript:alert(1)" }),
      "InvalidImageUrl"
    );
  });
});
