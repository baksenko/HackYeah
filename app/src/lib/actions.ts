import type { BN } from '@coral-xyz/anchor'
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'

import { USDC_MINT, contributionPda, tokenAccountOf, vaultOf, type FundraiserProgram } from './program'

export type ContributeArgs = {
  campaign: PublicKey
  /** The recipient the contributor was shown; the program refuses if it changed. */
  expectedRecipient: PublicKey
  contributor: PublicKey
  /** In USDC base units. */
  amount: BN
  nickname: string
  /** Private campaigns only: the invite key's public half (it must co-sign). */
  invite: PublicKey | null
}

/**
 * Builds an unsigned `contribute` transaction. Plain code with no React and
 * no wallet, so it is the one place that knows how a contribution is built:
 * the campaign page uses it today.
 *
 * EXTENSION POINT -- Solana Pay transaction requests. A wallet scanning a
 * `solana:https://…` QR code asks that URL for a transaction to sign. A
 * small endpoint would read the campaign and amount from the URL and the
 * contributor from the wallet's POST body, call this function, set the fee
 * payer and a recent blockhash, and return the serialized transaction. That
 * endpoint needs a server, which this project deliberately does not have
 * (CLAUDE.md: static site only), so it is left out; nothing else would
 * change. Private campaigns cannot work that way, because their invite key
 * must co-sign in the contributor's browser.
 */
export function buildContributeTransaction(program: FundraiserProgram, args: ContributeArgs): Promise<Transaction> {
  return program.methods
    .contribute(args.amount, args.nickname, args.expectedRecipient)
    .accountsPartial({
      contributor: args.contributor,
      campaign: args.campaign,
      contribution: contributionPda(args.campaign, args.contributor),
      mint: USDC_MINT,
      contributorToken: tokenAccountOf(args.contributor),
      vault: vaultOf(args.campaign),
      invite: args.invite,
    })
    .transaction()
}

/** The SPL Memo program (v2). An instruction with no accounts just records its text. */
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

export type WithdrawArgs = {
  campaign: PublicKey
  recipient: PublicKey
  /** Whoever triggers the payout; pays the fee, receives nothing. */
  caller: PublicKey
  /** The campaign's stored Solana Pay reference; the program requires it when set. */
  reference: PublicKey | null
  /** The campaign's stored Solana Pay memo; empty for none. */
  memo: string
}

/**
 * Builds an unsigned payout. When the campaign came from a shop's Solana Pay
 * request it carries that request's reference (the program refuses the
 * payout without it) and, if the request had a memo, an SPL Memo instruction
 * placed immediately before the payout -- where Solana Pay expects the memo
 * relative to the transfer.
 */
export async function buildWithdrawTransaction(program: FundraiserProgram, args: WithdrawArgs): Promise<Transaction> {
  const withdraw = await program.methods
    .withdraw()
    .accountsPartial({
      caller: args.caller,
      campaign: args.campaign,
      recipient: args.recipient,
      mint: USDC_MINT,
      vault: vaultOf(args.campaign),
      recipientToken: tokenAccountOf(args.recipient),
      reference: args.reference,
    })
    .instruction()
  const transaction = new Transaction()
  if (args.memo) {
    transaction.add(
      new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(args.memo, 'utf8') }),
    )
  }
  return transaction.add(withdraw)
}
