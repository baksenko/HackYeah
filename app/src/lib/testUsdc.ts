import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from '@solana/spl-token'
import { Keypair, Transaction, type PublicKey } from '@solana/web3.js'

import { IS_DEVNET } from './cluster'
import { USDC_MINT, tokenAccountOf } from './program'

/**
 * LOCALNET ONLY. The stand-in "USDC" mint that the localnet build of the
 * program accepts. Its key -- which is also its mint authority -- comes from
 * the public seed sha256("chip-in:localnet-test-usdc:v1") (see USDC_MINT in
 * constants.rs and scripts/seed-local.ts), so anyone can mint it: it is play
 * money on a local validator and exists nowhere else.
 */
const LOCAL_TEST_USDC = Keypair.fromSeed(
  Uint8Array.from(
    'cc24ddb6941b6728dcdbdf758723a23ae88c4a2f20fe257bfef2bc1e99f6fa43'
      .match(/../g)!
      .map((byte) => Number.parseInt(byte, 16)),
  ),
)

/** True when this app can mint test USDC itself (a local validator). */
export const CAN_MINT_TEST_USDC = !IS_DEVNET && USDC_MINT.equals(LOCAL_TEST_USDC.publicKey)

/** Where to get devnet USDC: Circle's faucet. */
export const DEVNET_USDC_FAUCET = 'https://faucet.circle.com'

/**
 * A transaction that opens `owner`'s USDC account if needed and mints
 * `amount` base units of local test USDC into it. The wallet pays the fee;
 * the returned signer (the public test mint key) must co-sign.
 */
export function mintTestUsdc(owner: PublicKey, amount: bigint): { transaction: Transaction; signer: Keypair } {
  const account = tokenAccountOf(owner)
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(owner, account, owner, USDC_MINT),
    createMintToInstruction(USDC_MINT, account, LOCAL_TEST_USDC.publicKey, amount),
  )
  return { transaction, signer: LOCAL_TEST_USDC }
}
