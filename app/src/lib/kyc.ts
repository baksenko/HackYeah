import { useWallet } from '@solana/wallet-adapter-react'
import { Keypair, PublicKey } from '@solana/web3.js'
import { useCallback, useEffect, useState } from 'react'

import { PROGRAM_ID, useProgram } from './program'

export const VERIFICATION_SEED = Buffer.from('verification')

/**
 * DEMO ONLY. The KYC verifier's key, derived from the public seed
 * sha256("chip-in:demo-kyc-verifier:v1") -- see KYC_VERIFIER in
 * program/programs/fundraiser/src/constants.rs.
 *
 * Because the seed is public, anyone can sign as this verifier, so the
 * identity check is a mock. What is real is the rule: the program refuses a
 * public campaign from a wallet this key has not verified. In production this
 * key lives only on a KYC provider's server, which signs after checking
 * documents; it never ships to a browser.
 */
export const DEMO_VERIFIER = Keypair.fromSeed(
  Uint8Array.from(
    '58d09638c3737428db3cabe700536fbd8c7145791b75b6334161aad6210bdb7c'
      .match(/../g)!
      .map((byte) => Number.parseInt(byte, 16)),
  ),
)

export function verificationPda(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([VERIFICATION_SEED, wallet.toBuffer()], PROGRAM_ID)[0]
}

export type VerificationStatus = 'unknown' | 'verified' | 'unverified'

/** Whether the connected wallet holds a verification record on chain. */
export function useVerification() {
  const program = useProgram()
  const { publicKey } = useWallet()
  const [result, setResult] = useState<{ wallet: string; verified: boolean } | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (!publicKey) return
    let cancelled = false
    program.account.verification
      .fetchNullable(verificationPda(publicKey))
      .then((record) => {
        if (!cancelled) setResult({ wallet: publicKey.toBase58(), verified: record !== null })
      })
      .catch(() => {
        // Unreadable counts as unverified; the program has the final word anyway.
        if (!cancelled) setResult({ wallet: publicKey.toBase58(), verified: false })
      })
    return () => {
      cancelled = true
    }
  }, [program, publicKey, refreshKey])

  const reload = useCallback(() => setRefreshKey((k) => k + 1), [])

  // A result for a previously connected wallet does not count for this one.
  const status: VerificationStatus =
    !publicKey || !result || result.wallet !== publicKey.toBase58()
      ? 'unknown'
      : result.verified
        ? 'verified'
        : 'unverified'

  return { status, reload }
}
