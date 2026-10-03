import type { Connection, Keypair, Transaction } from '@solana/web3.js'

import { explainFailure, type ProgramFailure } from './errors'

export type TxOutcome =
  | { kind: 'success'; signature: string }
  /** It reached the chain and the program refused it. There is a tx to look at. */
  | { kind: 'failed-on-chain'; signature: string; failure: ProgramFailure }
  /** Simulation or the wallet stopped it, so nothing was ever recorded. */
  | { kind: 'never-sent'; failure: ProgramFailure }

type SignerWallet = {
  publicKey: { toBase58(): string } & Parameters<typeof String>[0]
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>
}

/**
 * Signs and sends one transaction and reports what the chain did with it.
 *
 * `skipPreflight` matters for the demo: with preflight on, a doomed
 * transaction is caught by simulation and never lands, so there is nothing to
 * show. With it off, the transaction is really submitted and really rejected
 * by the program, leaving a failed transaction on the explorer as proof.
 */
export async function sendTransaction(
  connection: Connection,
  wallet: SignerWallet,
  transaction: Transaction,
  options: { skipPreflight?: boolean; extraSigners?: Keypair[] } = {},
): Promise<TxOutcome> {
  const { skipPreflight = false, extraSigners = [] } = options

  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    transaction.feePayer = wallet.publicKey as never
    transaction.recentBlockhash = blockhash

    const signed = await wallet.signTransaction(transaction)
    // Extra signers (the private-campaign invite key) sign *after* the wallet:
    // some wallets adjust a transaction while signing, which would invalidate
    // any signature collected before.
    if (extraSigners.length) signed.partialSign(...extraSigners)

    let signature: string
    try {
      signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight,
        preflightCommitment: 'confirmed',
      })
    } catch (error) {
      return { kind: 'never-sent', failure: explainFailure(error) }
    }

    const confirmation = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      'confirmed',
    )

    if (confirmation.value.err) {
      // Pull the logs so we can name the exact rule that rejected it.
      const detail = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      return {
        kind: 'failed-on-chain',
        signature,
        failure: explainFailure(confirmation.value.err, detail?.meta?.logMessages),
      }
    }

    return { kind: 'success', signature }
  } catch (error) {
    return { kind: 'never-sent', failure: explainFailure(error) }
  }
}
