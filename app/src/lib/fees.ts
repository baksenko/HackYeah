import type { Connection, PublicKey, Transaction } from '@solana/web3.js'

/**
 * Account sizes, mirrored from `program/programs/fundraiser/src/state.rs`
 * (8-byte discriminator + `INIT_SPACE`). They decide the one-time deposit the
 * payer locks up when the account is created. Update these if the structs change.
 *
 *   Campaign:     8 + 32 + 32 + 8 + (4 + 64) + 8 + 8 + 8 + 8 + 1
 *                 + (1 + 32) invite + 4 tags + 1 bump             = 219
 *   Contribution: 8 + 32 + 32 + 8 + (4 + 32) nickname + 1 bump    = 117
 */
export const CAMPAIGN_ACCOUNT_SPACE = 219
export const CONTRIBUTION_ACCOUNT_SPACE = 117

/** What one signature costs on Solana when the cluster cannot tell us. */
const FALLBACK_FEE_LAMPORTS = 5000

/**
 * The network fee the cluster would charge for this exact transaction.
 * Sets the fee payer and a fresh blockhash on `transaction` so it can be
 * compiled; `sendTransaction` replaces the blockhash again before signing.
 */
export async function networkFee(
  connection: Connection,
  transaction: Transaction,
  feePayer: PublicKey,
): Promise<number> {
  transaction.feePayer = feePayer
  transaction.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash
  try {
    const { value } = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed')
    return value ?? FALLBACK_FEE_LAMPORTS
  } catch {
    return FALLBACK_FEE_LAMPORTS
  }
}

/** The rent-exempt deposit for an account of `space` bytes. */
export const accountDeposit = (connection: Connection, space: number): Promise<number> =>
  connection.getMinimumBalanceForRentExemption(space)
