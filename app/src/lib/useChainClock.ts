import { useConnection } from '@solana/wallet-adapter-react'
import { useEffect, useState } from 'react'

const localNow = () => Math.floor(Date.now() / 1000)

/**
 * Unix seconds as the *cluster* sees them.
 *
 * The program compares deadlines against the chain's clock, so the UI has to
 * as well. A browser whose clock is a minute fast would otherwise offer
 * buttons the program is about to reject.
 */
export function useChainClock(): number {
  const { connection } = useConnection()
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(localNow)

  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      try {
        const slot = await connection.getSlot()
        const chainTime = await connection.getBlockTime(slot)
        if (chainTime && !cancelled) setOffset(chainTime - localNow())
      } catch {
        // Keep the last known offset; the local clock is a fine fallback.
      }
    }
    void sync()
    const id = setInterval(() => void sync(), 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [connection])

  useEffect(() => {
    const id = setInterval(() => setNow(localNow()), 1000)
    return () => clearInterval(id)
  }, [])

  return now + offset
}
