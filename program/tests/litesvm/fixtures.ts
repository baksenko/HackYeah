// Shared builders for program calls, so every suite creates campaigns and
// derives addresses the same way.
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
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
  /** Solana Pay payment-request data stored on the campaign. */
  reference?: PublicKey;
  memo?: string;
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
      o.imageUrl ?? "",
      o.reference ?? null,
      o.memo ?? ""
    )
    .accountsPartial(accounts)
    .signers([o.organizer])
    .rpc();
  return { id, campaign, deadline, vault: vaultOf(campaign, o.mint ?? TEST_USDC_MINT) };
}

export function updateRecipient(
  h: Harness,
  campaign: PublicKey,
  organizer: Keypair,
  newRecipient: PublicKey,
  payment: { reference?: PublicKey | null; memo?: string } = {}
) {
  return h.program.methods
    .updateRecipient(newRecipient, payment.reference ?? null, payment.memo ?? "")
    .accountsPartial({ organizer: organizer.publicKey, campaign })
    .signers([organizer])
    .rpc();
}

export type ContributeOptions = {
  nickname?: string;
  invite?: Keypair;
  /** Defaults to the campaign's current recipient, read from chain. */
  expectedRecipient?: PublicKey;
  /** Overrides, to test that the program refuses them. */
  mint?: PublicKey;
  contributorToken?: PublicKey;
  vault?: PublicKey;
  /**
   * Pass the payout accounts (as the app does), so the contribution that
   * completes the goal pays the recipient in the same transaction. The
   * recipient's token account is created idempotently in that transaction.
   */
  payout?: boolean;
  /** Payout overrides, to test that the program refuses them. */
  payoutRecipient?: PublicKey;
  payoutRecipientToken?: PublicKey;
  /** Defaults to the stored reference; `null` passes none. */
  payoutReference?: PublicKey | null;
};

/** The contributor's own USDC account (the one `fundTokens` creates). */
export const tokenAccountOf = (owner: PublicKey, mint: PublicKey = TEST_USDC_MINT) =>
  getAssociatedTokenAddressSync(mint, owner, true);

/** Calls contribute with `amount` in base units (use `USDC` to scale). */
export async function contribute(
  h: Harness,
  campaign: PublicKey,
  contributor: Keypair,
  amount: number | bigint,
  o: ContributeOptions = {}
) {
  const state = await h.program.account.campaign.fetch(campaign);
  const expectedRecipient = o.expectedRecipient ?? state.recipient;
  const mint = o.mint ?? TEST_USDC_MINT;

  const recipient = o.payout ? o.payoutRecipient ?? state.recipient : null;
  const recipientToken = o.payout ? o.payoutRecipientToken ?? tokenAccountOf(state.recipient, mint) : null;
  const pre = o.payout
    ? [
        createAssociatedTokenAccountIdempotentInstruction(
          contributor.publicKey,
          tokenAccountOf(state.recipient, mint),
          state.recipient,
          mint
        ),
      ]
    : [];

  return h.program.methods
    .contribute(new BN(amount.toString()), o.nickname ?? "", expectedRecipient)
    .accountsPartial({
      contributor: contributor.publicKey,
      campaign,
      contribution: contributionPda(h, campaign, contributor.publicKey),
      mint,
      contributorToken: o.contributorToken ?? tokenAccountOf(contributor.publicKey, mint),
      vault: o.vault ?? vaultOf(campaign, mint),
      invite: o.invite?.publicKey ?? null,
      recipient,
      recipientToken,
      reference: o.payout ? (o.payoutReference === undefined ? state.reference : o.payoutReference) : null,
    })
    .preInstructions(pre)
    .signers(o.invite ? [contributor, o.invite] : [contributor])
    .rpc();
}

export type WithdrawOptions = {
  /**
   * Solana Pay reference passed read-only. Defaults to the one stored on the
   * campaign; `null` passes none, to test that the program refuses it.
   */
  reference?: PublicKey | null;
  /** Overrides, to test that the program refuses them. */
  recipient?: PublicKey;
  recipientToken?: PublicKey;
  vault?: PublicKey;
};

/** Calls withdraw, signed and paid for by `caller` (anyone). */
export async function withdraw(h: Harness, campaign: PublicKey, caller: Keypair, o: WithdrawOptions = {}) {
  const state = await h.program.account.campaign.fetch(campaign);
  const recipient = o.recipient ?? state.recipient;
  return h.program.methods
    .withdraw()
    .accountsPartial({
      caller: caller.publicKey,
      campaign,
      recipient,
      mint: state.mint,
      vault: o.vault ?? vaultOf(campaign, state.mint),
      recipientToken: o.recipientToken ?? tokenAccountOf(recipient, state.mint),
      reference: o.reference === undefined ? state.reference : o.reference,
    })
    .signers([caller])
    .rpc();
}

export type RefundOptions = {
  /** Whose receipt to claim (defaults to the caller's own). */
  receiptOf?: PublicKey;
  contributorToken?: PublicKey;
  vault?: PublicKey;
};

export async function refund(h: Harness, campaign: PublicKey, contributor: Keypair, o: RefundOptions = {}) {
  const state = await h.program.account.campaign.fetch(campaign);
  return h.program.methods
    .refund()
    .accountsPartial({
      contributor: contributor.publicKey,
      campaign,
      contribution: contributionPda(h, campaign, o.receiptOf ?? contributor.publicKey),
      mint: state.mint,
      vault: o.vault ?? vaultOf(campaign, state.mint),
      contributorToken: o.contributorToken ?? tokenAccountOf(contributor.publicKey, state.mint),
    })
    .signers([contributor])
    .rpc();
}

export function cancel(h: Harness, campaign: PublicKey, organizer: Keypair) {
  return h.program.methods
    .cancel()
    .accountsPartial({ organizer: organizer.publicKey, campaign })
    .signers([organizer])
    .rpc();
}

export function closeCampaign(h: Harness, campaign: PublicKey, organizer: Keypair) {
  return h.program.methods
    .closeCampaign()
    .accountsPartial({ organizer: organizer.publicKey, campaign, vault: vaultOf(campaign) })
    .signers([organizer])
    .rpc();
}
