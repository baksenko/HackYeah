// Shared builders for program calls, so every suite creates campaigns and
// derives addresses the same way.
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";

import { anchor, Harness, TEST_USDC_MINT, USDC } from "./harness";

const { BN } = anchor;

export function campaignPda(h: Harness, organizer: PublicKey, id: anchor.BN): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), organizer.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
    h.program.programId
  )[0];
}

export function contributionPda(h: Harness, campaign: PublicKey, contributor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("contribution"), campaign.toBuffer(), contributor.toBuffer()],
    h.program.programId
  )[0];
}

/** The campaign's escrow: its associated token account for the mint. */
export const vaultOf = (campaign: PublicKey, mint: PublicKey = TEST_USDC_MINT) =>
  getAssociatedTokenAddressSync(mint, campaign, true);

let nextId = 0;

export type CreateOptions = {
  organizer: Keypair;
  /** Goal in whole USDC. */
  goalUsdc?: number;
  secondsFromNow?: number;
  recipient?: PublicKey;
  /** Makes the campaign private, gated on this key. */
  invite?: PublicKey;
  title?: string;
  tags?: number;
  description?: string;
  imageUrl?: string;
  /** Overrides, to test that the program refuses them. */
  mint?: PublicKey;
  vault?: PublicKey;
};

/**
 * Calls create_campaign. The mint, vault and program accounts are left for
 * Anchor to resolve from the IDL unless overridden.
 */
export async function createCampaign(h: Harness, o: CreateOptions) {
  const id = new BN(++nextId);
  const campaign = campaignPda(h, o.organizer.publicKey, id);
  const deadline = h.now() + (o.secondsFromNow ?? 3600);
  const accounts: Record<string, PublicKey> = { organizer: o.organizer.publicKey, campaign };
  if (o.mint) accounts.mint = o.mint;
  if (o.vault) accounts.vault = o.vault;
  else if (o.mint) accounts.vault = vaultOf(campaign, o.mint);

  await h.program.methods
    .createCampaign(
      id,
      o.title ?? "Test campaign",
      new BN((o.goalUsdc ?? 100) * USDC),
      new BN(deadline),
      o.recipient ?? o.organizer.publicKey,
      o.invite ?? null,
      o.tags ?? 0,
      o.description ?? "",
      o.imageUrl ?? ""
    )
    .accountsPartial(accounts)
    .signers([o.organizer])
    .rpc();
  return { id, campaign, deadline, vault: vaultOf(campaign, o.mint ?? TEST_USDC_MINT) };
}

export function updateRecipient(h: Harness, campaign: PublicKey, organizer: Keypair, newRecipient: PublicKey) {
  return h.program.methods
    .updateRecipient(newRecipient)
    .accountsPartial({ organizer: organizer.publicKey, campaign })
    .signers([organizer])
    .rpc();
}

/**
 * The current (pre-USDC) contribute instruction, still moving SOL. Replaced
 * by the token version in the next step.
 */
export function contributeSol(
  h: Harness,
  campaign: PublicKey,
  contributor: Keypair,
  lamports: number,
  invite?: Keypair
) {
  return h.program.methods
    .contribute(new BN(lamports), "")
    .accountsPartial({
      contributor: contributor.publicKey,
      campaign,
      contribution: contributionPda(h, campaign, contributor.publicKey),
      invite: invite?.publicKey ?? null,
    })
    .signers(invite ? [contributor, invite] : [contributor])
    .rpc();
}
