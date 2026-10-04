// Fills a LOCAL validator with USDC campaigns in every state the app shows
// (open, goal reached, goal missed, cancelled, paid out) so the UI can be
// checked without waiting around.
//
//   solana-test-validator --ledger program/test-ledger --reset --quiet \
//     --bpf-program <PROGRAM_ID> program/target/deploy/fundraiser.so
//   ./scripts/seed-local.sh
//   cd app && VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
//
// Local only. It creates the localnet test-USDC mint at the address the
// localnet build of the program expects (USDC_MINT in constants.rs). That
// mint's key comes from a public seed, so anyone can mint test USDC on a
// local validator -- which is the point: it is play money.
import * as anchor from "@coral-xyz/anchor";
import {
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import fs from "fs";

const RPC = "http://127.0.0.1:8899";
const idl = JSON.parse(fs.readFileSync(new URL("../program/target/idl/fundraiser.json", import.meta.url), "utf8"));
const CAMPAIGN_SEED = Buffer.from("campaign");
const CONTRIBUTION_SEED = Buffer.from("contribution");
const USDC = 1_000_000; // 6 decimals
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The localnet test-USDC mint: its own key is also its mint authority. */
const TEST_USDC = Keypair.fromSeed(createHash("sha256").update("chip-in:localnet-test-usdc:v1").digest());

async function main() {
  const connection = new anchor.web3.Connection(RPC, "confirmed");
  const organizer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(organizer), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  const expectedMint = String(idl.constants.find((c: any) => c.name === "USDC_MINT")?.value);
  if (expectedMint !== TEST_USDC.publicKey.toBase58()) {
    throw new Error(`This program build expects USDC mint ${expectedMint}; seed only a localnet build.`);
  }

  if (!(await connection.getAccountInfo(TEST_USDC.publicKey))) {
    await createMint(connection, organizer, TEST_USDC.publicKey, null, 6, TEST_USDC);
    console.log("created test USDC mint", TEST_USDC.publicKey.toBase58());
  }

  const fundSol = async (kp: Keypair, sol: number) => {
    const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  };
  const fundUsdc = async (owner: PublicKey, usdc: number) => {
    const ata = await getOrCreateAssociatedTokenAccount(connection, organizer, TEST_USDC.publicKey, owner);
    await mintTo(connection, organizer, TEST_USDC.publicKey, ata.address, TEST_USDC, BigInt(usdc * USDC));
  };

  const bob = Keypair.generate(); await fundSol(bob, 5); await fundUsdc(bob.publicKey, 5000);
  const carol = Keypair.generate(); await fundSol(carol, 5); await fundUsdc(carol.publicKey, 5000);
  console.log("bob  ", bob.publicKey.toBase58());
  console.log("carol", carol.publicKey.toBase58());

  const chainNow = async () => (await connection.getBlockTime(await connection.getSlot()))!;

  let id = 0n;
  const create = async (title: string, goalUsdc: number, secs: number, invite: Keypair | null = null, tagBits: number[] = [], description = "", imageUrl = "") => {
    const tags = tagBits.reduce((m, b) => (m | (1 << b)) >>> 0, 0);
    const campaignId = ++id;
    const idBytes = Buffer.alloc(8); idBytes.writeBigUInt64LE(campaignId);
    const campaign = PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, organizer.publicKey.toBuffer(), idBytes], program.programId)[0];
    const deadline = (await chainNow()) + secs;
    await program.methods.createCampaign(
      new anchor.BN(campaignId.toString()), title,
      new anchor.BN(goalUsdc * USDC), new anchor.BN(deadline), organizer.publicKey,
      invite ? invite.publicKey : null, tags, description, imageUrl, null, "")
      .accountsPartial({ organizer: organizer.publicKey, campaign, mint: TEST_USDC.publicKey })
      .rpc();
    console.log(`created ${invite ? "PRIVATE" : "public "} "${title}" -> ${campaign.toBase58()} (goal ${goalUsdc} USDC, deadline +${secs}s)`);
    if (invite) {
      const secret = anchor.utils.bytes.bs58.encode(invite.secretKey);
      console.log(`   invite link: http://localhost:5173/c/${campaign.toBase58()}#invite=${secret}`);
    }
    return { campaign, deadline };
  };

  const give = async (campaign: PublicKey, who: Keypair, usdc: number, nickname: string, invite: Keypair | null = null) => {
    const contribution = PublicKey.findProgramAddressSync(
      [CONTRIBUTION_SEED, campaign.toBuffer(), who.publicKey.toBuffer()], program.programId)[0];
    await program.methods.contribute(new anchor.BN(usdc * USDC), nickname, organizer.publicKey)
      .accountsPartial({
        contributor: who.publicKey, campaign, contribution, mint: TEST_USDC.publicKey,
        contributorToken: getAssociatedTokenAddressSync(TEST_USDC.publicKey, who.publicKey),
        vault: getAssociatedTokenAddressSync(TEST_USDC.publicKey, campaign, true),
        invite: invite ? invite.publicKey : null,
      })
      .signers(invite ? [who, invite] : [who]).rpc();
  };

  const payOut = (campaign: PublicKey) =>
    program.methods.withdraw()
      .accountsPartial({
        caller: organizer.publicKey, campaign, recipient: organizer.publicKey, mint: TEST_USDC.publicKey,
        vault: getAssociatedTokenAddressSync(TEST_USDC.publicKey, campaign, true),
        recipientToken: getAssociatedTokenAddressSync(TEST_USDC.publicKey, organizer.publicKey),
        reference: null,
      })
      .rpc();

  // Tag bits — see app/src/lib/tags.ts.
  const T = {
    medical: 0, education: 1, community: 2, animals: 3, environment: 4, emergency: 5, tech: 8,
    localBusiness: 9, trip: 16, gift: 17, birthday: 18, flatmates: 20, sharedPurchase: 24, gear: 25,
  };
  const H2 = 7200;

  // ---- public, open
  const open = await create("New playground for Zielona Street", 2000, H2, null, [T.community, T.localBusiness],
    "The old swings were removed and nothing replaced them. We want swings, a slide and a sandpit on the green at the end of Zielona Street. The council installs it if we cover the equipment.");
  await give(open.campaign, bob, 750, "Kuba");
  await give(open.campaign, carol, 400, "Ola");

  const laptops = await create("Laptops for the village school", 1600, H2, null, [T.education, T.tech],
    "Our school shares six old laptops between 80 pupils. Four refurbished laptops would let a whole class do computer lessons at once.");
  await give(laptops.campaign, carol, 1000, "Ola");

  const clinic = await create("Flood relief for the local clinic", 3000, H2, null, [T.medical, T.emergency, T.community],
    "Last week's flood ruined the clinic's ground floor. This covers new flooring and a vaccine fridge, so the clinic can reopen.");
  await give(clinic.campaign, bob, 500, "Kuba");

  // ---- private, open
  const tripInvite = Keypair.generate();
  const trip = await create("Trip to New Zealand", 3000, H2, tripInvite, [T.trip],
    "Shared deposit for the campervan and the first two nights. Everyone chips in the same amount.");
  await give(trip.campaign, bob, 1200, "Kuba", tripInvite);
  await give(trip.campaign, carol, 800, "Ola", tripInvite);

  const giftInvite = Keypair.generate();
  const gift = await create("Anna's 30th birthday present", 150, H2, giftInvite, [T.gift, T.birthday],
    "A weekend at the spa she keeps talking about. Keep it a secret!");
  await give(gift.campaign, carol, 30, "Ola", giftInvite);

  // ---- goal reached: Succeeded immediately, waiting for anyone to pay it out
  const cats = await create("Shelter for street cats", 100, H2, null, [T.animals]);
  await give(cats.campaign, bob, 60, "Kuba");
  await give(cats.campaign, carol, 40, "Ola"); // exactly the goal: contributions stop there

  // ---- paid out
  const garden = await create("Community garden seeds", 100, H2, null, [T.environment, T.community]);
  await give(garden.campaign, carol, 100, "Ola");
  await payOut(garden.campaign);

  // ---- cancelled by the organizer: refunds open
  const stage = await create("Stage for the street festival", 800, H2, null, [T.community]);
  await give(stage.campaign, bob, 120, "Kuba");
  await program.methods.cancel().accountsPartial({ organizer: organizer.publicKey, campaign: stage.campaign }).rpc();

  // ---- goal missed: needs its (short) deadline to pass
  const skiInvite = Keypair.generate();
  const ski = await create("Ski trip deposit", 500, 6, skiInvite, [T.trip, T.gear]);
  await give(ski.campaign, bob, 30, "Kuba", skiInvite);
  console.log("waiting for the short deadline...");
  while ((await chainNow()) < ski.deadline) await sleep(1000);

  console.log("\nSTATES:");
  const rows = [["open", open.campaign], ["private", trip.campaign], ["reached", cats.campaign],
    ["paid out", garden.campaign], ["cancelled", stage.campaign], ["missed", ski.campaign]] as const;
  for (const [label, c] of rows) {
    const s: any = await program.account.campaign.fetch(c);
    console.log(` ${label.padEnd(10)} ${c.toBase58()} raised=${s.totalRaised.toNumber() / USDC} goal=${s.goal.toNumber() / USDC} status=${Object.keys(s.status)[0]}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
