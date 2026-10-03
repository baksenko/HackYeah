// Fills a LOCAL validator with campaigns in all four states (open, succeeded,
// failed, withdrawn) so the UI can be checked without waiting around.
//
//   solana-test-validator --ledger program/test-ledger --reset --quiet
//   solana program deploy --url localhost \
//     --program-id program/target/deploy/fundraiser-keypair.json \
//     program/target/deploy/fundraiser.so
//   ./scripts/seed-local.sh
//   cd ../app && VITE_RPC_ENDPOINT=http://127.0.0.1:8899 npm run dev
//
// Local only. The devnet demo is driven through the UI with real wallets.
import * as anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "fs";

const RPC = "http://127.0.0.1:8899";
const idl = JSON.parse(fs.readFileSync(new URL("../program/target/idl/fundraiser.json", import.meta.url), "utf8"));
const CAMPAIGN_SEED = Buffer.from("campaign");
const CONTRIBUTION_SEED = Buffer.from("contribution");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const connection = new anchor.web3.Connection(RPC, "confirmed");
  const organizer = Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf8")))
  );
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(organizer), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  const fund = async (kp: Keypair, sol: number) => {
    const sig = await connection.requestAirdrop(kp.publicKey, sol * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  };

  const bob = Keypair.generate(); await fund(bob, 20);
  const carol = Keypair.generate(); await fund(carol, 20);
  console.log("bob  ", bob.publicKey.toBase58());
  console.log("carol", carol.publicKey.toBase58());

  const chainNow = async () => (await connection.getBlockTime(await connection.getSlot()))!;

  let id = 0n;
  const create = async (title: string, goalSol: number, secs: number, invite: Keypair | null = null, tagBits: number[] = [], description = "", imageUrl = "") => {
    const tags = tagBits.reduce((m, b) => (m | (1 << b)) >>> 0, 0);
    const campaignId = ++id;
    const idBytes = Buffer.alloc(8); idBytes.writeBigUInt64LE(campaignId);
    const campaign = PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, organizer.publicKey.toBuffer(), idBytes], program.programId)[0];
    const deadline = (await chainNow()) + secs;
    await program.methods.createCampaign(
      new anchor.BN(campaignId.toString()), title,
      new anchor.BN(goalSol * LAMPORTS_PER_SOL), new anchor.BN(deadline), organizer.publicKey,
      invite ? invite.publicKey : null, tags, description, imageUrl)
      .accountsPartial({ organizer: organizer.publicKey, campaign, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`created ${invite ? "PRIVATE" : "public "} "${title}" -> ${campaign.toBase58()} (deadline +${secs}s)`);
    if (invite) {
      const secret = anchor.utils.bytes.bs58.encode(invite.secretKey);
      console.log(`   invite link: http://localhost:5173/c/${campaign.toBase58()}#invite=${secret}`);
    }
    return { campaign, deadline };
  };

  const give = async (campaign: PublicKey, who: Keypair, sol: number, nickname: string, invite: Keypair | null = null) => {
    const contribution = PublicKey.findProgramAddressSync(
      [CONTRIBUTION_SEED, campaign.toBuffer(), who.publicKey.toBuffer()], program.programId)[0];
    await program.methods.contribute(new anchor.BN(sol * LAMPORTS_PER_SOL), nickname)
      .accountsPartial({ contributor: who.publicKey, campaign, contribution,
        invite: invite ? invite.publicKey : null, systemProgram: SystemProgram.programId })
      .signers(invite ? [who, invite] : [who]).rpc();
  };

  // Tag bits — see app/src/lib/tags.ts.
  const T = {
    medical: 0, education: 1, community: 2, animals: 3, environment: 4, emergency: 5, tech: 8,
    localBusiness: 9, trip: 16, gift: 17, birthday: 18, flatmates: 20, sharedPurchase: 24, gear: 25,
  };
  const H2 = 7200;

  // ---- public, open
  const open = await create("New playground for Zielona Street", 2, H2, null, [T.community, T.localBusiness],
    "The old swings were removed last spring and nothing replaced them. We want a small playground with swings, a slide and a sandpit on the green at the end of Zielona Street. The council has agreed to install it if we cover the equipment.");
  await give(open.campaign, bob, 0.75, "Kuba");
  await give(open.campaign, carol, 0.4, "Ola");

  const laptops = await create("Laptops for the village school", 4, H2, null, [T.education, T.tech],
    "Our school shares six old laptops between 80 pupils. Four refurbished laptops would let a whole class do computer lessons at once.");
  await give(laptops.campaign, carol, 2.5, "Ola");

  const clinic = await create("Flood relief for the local clinic", 3, H2, null, [T.medical, T.emergency, T.community],
    "Last week's flood ruined the clinic's ground floor. This covers new flooring and a replacement fridge for vaccines, so the clinic can reopen.");
  await give(clinic.campaign, bob, 0.5, "Kuba");

  // ---- private, open
  const tripInvite = Keypair.generate();
  const trip = await create("Trip to New Zealand", 3, H2, tripInvite, [T.trip],
    "Shared deposit for the campervan and the first two nights. Everyone chips in the same amount.");
  await give(trip.campaign, bob, 1.2, "Kuba", tripInvite);
  await give(trip.campaign, carol, 0.8, "Ola", tripInvite);

  const giftInvite = Keypair.generate();
  const gift = await create("Anna's 30th birthday present", 1.5, H2, giftInvite, [T.gift, T.birthday],
    "A weekend at the spa she keeps talking about. Keep it a secret!");
  await give(gift.campaign, carol, 0.3, "Ola", giftInvite);

  const sofaInvite = Keypair.generate();
  const sofa = await create("New sofa for the flat", 2, H2, sofaInvite, [T.flatmates, T.sharedPurchase]);
  await give(sofa.campaign, bob, 0.5, "Kuba", sofaInvite);

  // ---- short deadlines: these settle into the closed states
  const win = await create("Shelter for street cats", 1, 6, null, [T.animals]);
  await give(win.campaign, bob, 0.6, "Kuba");
  await give(win.campaign, carol, 0.5, "Ola");

  const loseInvite = Keypair.generate();
  const lose = await create("Ski trip deposit", 5, 6, loseInvite, [T.trip, T.gear]);
  await give(lose.campaign, bob, 0.3, "Kuba", loseInvite);

  const done = await create("Community garden seeds", 1, 6, null, [T.environment, T.community]);
  await give(done.campaign, carol, 1, "Ola");

  console.log("waiting for the short deadlines...");
  while ((await chainNow()) < done.deadline) await sleep(1000);
  await sleep(1500);

  await program.methods.withdraw()
    .accountsPartial({ recipient: organizer.publicKey, campaign: done.campaign }).rpc();
  console.log("withdrew Community garden seeds");

  console.log("\nSTATES:");
  for (const [label, c] of [["open", open.campaign], ["private", trip.campaign], ["succeeded", win.campaign], ["failed", lose.campaign], ["withdrawn", done.campaign]] as const) {
    const s: any = await program.account.campaign.fetch(c);
    console.log(` ${label.padEnd(10)} ${c.toBase58()} raised=${s.totalRaised.toNumber()/1e9} goal=${s.goal.toNumber()/1e9} withdrawn=${s.withdrawn}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
