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
  const create = async (title: string, goalSol: number, secs: number, invite: Keypair | null = null) => {
    const campaignId = ++id;
    const idBytes = Buffer.alloc(8); idBytes.writeBigUInt64LE(campaignId);
    const campaign = PublicKey.findProgramAddressSync(
      [CAMPAIGN_SEED, organizer.publicKey.toBuffer(), idBytes], program.programId)[0];
    const deadline = (await chainNow()) + secs;
    await program.methods.createCampaign(
      new anchor.BN(campaignId.toString()), title,
      new anchor.BN(goalSol * LAMPORTS_PER_SOL), new anchor.BN(deadline), organizer.publicKey,
      invite ? invite.publicKey : null)
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

  // public, open for 2 hours
  const open = await create("New playground for Zielona Street", 2, 7200);
  await give(open.campaign, bob, 0.75, "Kuba");
  await give(open.campaign, carol, 0.4, "Ola");

  // private, open for 2 hours
  const tripInvite = Keypair.generate();
  const trip = await create("Trip to New Zealand", 3, 7200, tripInvite);
  await give(trip.campaign, bob, 1.2, "Kuba", tripInvite);
  await give(trip.campaign, carol, 0.8, "Ola", tripInvite);

  // public, will succeed
  const win = await create("Shelter for street cats", 1, 6);
  await give(win.campaign, bob, 0.6, "Kuba");
  await give(win.campaign, carol, 0.5, "Ola");

  // private, will fail
  const loseInvite = Keypair.generate();
  const lose = await create("Ski trip deposit", 5, 6, loseInvite);
  await give(lose.campaign, bob, 0.3, "Kuba", loseInvite);

  // public, will be withdrawn
  const done = await create("Community garden seeds", 1, 6);
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
