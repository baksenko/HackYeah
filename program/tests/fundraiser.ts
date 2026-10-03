import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { Fundraiser } from "../target/types/fundraiser";

const CAMPAIGN_SEED = Buffer.from("campaign");
const CONTRIBUTION_SEED = Buffer.from("contribution");

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
  }) {
    const id = freshId();
    const campaign = campaignPda(opts.organizer.publicKey, id);
    const deadline = (await chainNow()) + (opts.secondsFromNow ?? DEADLINE_SECS);
    await program.methods
      .createCampaign(
        id,
        opts.title ?? "Test campaign",
        new anchor.BN(opts.goalSol * LAMPORTS_PER_SOL),
        new anchor.BN(deadline),
        opts.recipient ?? opts.organizer.publicKey
      )
      .accounts({
        organizer: opts.organizer.publicKey,
        campaign,
        systemProgram: SystemProgram.programId,
      })
      .signers([opts.organizer])
      .rpc();
    return { id, campaign, deadline };
  }

  function contribute(campaign: PublicKey, contributor: Keypair, sol: number) {
    return program.methods
      .contribute(new anchor.BN(sol * LAMPORTS_PER_SOL))
      .accounts({
        contributor: contributor.publicKey,
        campaign,
        contribution: contributionPda(campaign, contributor.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([contributor])
      .rpc();
  }

  const withdraw = (campaign: PublicKey, recipient: Keypair) =>
    program.methods
      .withdraw()
      .accounts({ recipient: recipient.publicKey, campaign })
      .signers([recipient])
      .rpc();

  const refund = (campaign: PublicKey, contributor: Keypair) =>
    program.methods
      .refund()
      .accounts({
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
});
