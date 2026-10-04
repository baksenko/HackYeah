import { getPrimaryDomain } from '@bonfida/spl-name-service'
import { Connection, PublicKey } from '@solana/web3.js'
import { useEffect, useState } from 'react'

/**
 * Readable names for wallets, from Solana Name Service (.sol domains).
 *
 * SNS lives on mainnet only, so this is the one place the app talks to
 * mainnet — read-only, to look up a *name*. No money and no transaction ever
 * goes there. The public mainnet RPC rate-limits heavily; set
 * VITE_SNS_RPC_ENDPOINT to a dedicated mainnet RPC for anything beyond a demo.
 *
 * A name is a label, not proof of identity: anyone can register any free
 * name. It helps people recognise a recipient they already know; the full
 * address stays on screen next to it.
 */
const SNS_RPC = (import.meta.env.VITE_SNS_RPC_ENDPOINT as string | undefined) ?? 'https://api.mainnet-beta.solana.com'

let connection: Connection | null = null
const mainnet = () =>
  (connection ??= new Connection(SNS_RPC, { commitment: 'confirmed', disableRetryOnRateLimit: true }))

/** One lookup per address per page load; failures (no name, rate limit) mean "no name". */
const cache = new Map<string, Promise<string | null>>()

export function lookupSolName(address: string): Promise<string | null> {
  let pending = cache.get(address)
  if (!pending) {
    pending = (async () => {
      try {
        const primary = await getPrimaryDomain(mainnet(), new PublicKey(address))
        // Stale: the name was transferred away since it was set as primary,
        // so it no longer describes this wallet. Do not show it.
        return primary.stale ? null : `${primary.reverse}.sol`
      } catch {
        return null
      }
    })()
    cache.set(address, pending)
  }
  return pending
}

/** The wallet's primary .sol name, or null (none, stale, or lookup failed). */
export function useSolName(address: string): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setName(null)
    void lookupSolName(address).then((n) => {
      if (!cancelled) setName(n)
    })
    return () => {
      cancelled = true
    }
  }, [address])
  return name
}
