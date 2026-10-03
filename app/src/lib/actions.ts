import type { BN } from '@coral-xyz/anchor'
import type { PublicKey, Transaction } from '@solana/web3.js'

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
