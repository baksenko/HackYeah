import type { Connection, PublicKey, TokenBalance } from '@solana/web3.js'

/** What a shop expects to receive for one order. */
export type ExpectedPayment = {
  /** The shop's wallet: the owner of the token account that must be credited. */
  recipient: PublicKey
  mint: PublicKey
  /** In the mint's base units. */
  amount: bigint
}

export type FoundPayment = {
  signature: string
  slot: number
  /** The memo the payment carried, if any (from the SPL Memo program's log). */
  memo: string | null
}

/**
 * How much `owner`'s token account(s) for `mint` gained in a transaction,
 * from the transaction's own pre/post token balances -- so it does not matter
 * how the transfer was made (directly, or inside a program like Chip In's
 * payout). An account opened in the transaction has no pre balance: 0.
 */
export function tokenBalanceIncrease(
  pre: TokenBalance[] | null | undefined,
  post: TokenBalance[] | null | undefined,
  owner: PublicKey,
  mint: PublicKey,
): bigint {
  const sum = (balances: TokenBalance[] | null | undefined) =>
    (balances ?? [])
      .filter((b) => b.owner === owner.toBase58() && b.mint === mint.toBase58())
      .reduce((total, b) => total + BigInt(b.uiTokenAmount.amount), 0n)
  return sum(post) - sum(pre)
}

/**
 * The merchant side of Solana Pay's reference-based verification: finds a
 * successful transaction that carries `reference` and credited the shop with
 * exactly the expected amount. Failed transactions carrying the reference (for
 * example a payout refused because the goal was not reached) are skipped.
 * Returns null while nothing qualifying has landed.
 *
 * Why not @solana/pay's validateTransfer: it accepts only a payment whose last
 * top-level instruction is a token transfer into the shop's account. Chip In's
 * payout moves the tokens from inside the program (the money is held by the
 * program, so nothing else could move it), which validateTransfer rejects as
 * "invalid transfer". Its findReference does find the payout.
 */
export async function findPayment(
  connection: Connection,
  reference: PublicKey,
  expected: ExpectedPayment,
): Promise<FoundPayment | null> {
  const signatures = await connection.getSignaturesForAddress(reference, undefined, 'confirmed')
  for (const sig of signatures) {
    if (sig.err) continue
    const tx = await connection.getTransaction(sig.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!tx?.meta || tx.meta.err) continue
    const received = tokenBalanceIncrease(tx.meta.preTokenBalances, tx.meta.postTokenBalances, expected.recipient, expected.mint)
    if (received !== expected.amount) continue
    const memoLog = tx.meta.logMessages?.find((line) => line.startsWith('Program log: Memo (len'))
    return {
      signature: sig.signature,
      slot: tx.slot,
      memo: memoLog ? (/: "(.*)"$/.exec(memoLog)?.[1] ?? null) : null,
    }
  }
  return null
}
