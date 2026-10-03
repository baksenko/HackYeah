import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useCallback, useEffect, useState } from 'react'

import { CLUSTER_LABEL, IS_DEVNET } from '../lib/cluster'
import { formatSol } from '../lib/format'

/** Below this, a wallet cannot realistically pay for a campaign plus fees. */
const LOW_BALANCE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL

/**
 * Shows what the connected wallet actually holds *on the cluster this app is
 * talking to*, and offers test SOL when it is short.
 *
 * This exists because the most confusing failure for a newcomer is a wallet
 * that looks funded in Phantom but is empty here — Phantom displays whichever
 * network it is set to, which is not necessarily the one this app uses.
 */
export function WalletBalance() {
  const { connection } = useConnection()
  const { publicKey } = useWallet()

  const [lamports, setLamports] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setLamports(null)
      return
    }
    try {
      setLamports(await connection.getBalance(publicKey, 'confirmed'))
    } catch {
      setLamports(null)
    }
  }, [connection, publicKey])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 10_000)
    return () => clearInterval(id)
  }, [refresh])

  const getTestSol = useCallback(async () => {
    if (!publicKey) return
    setBusy(true)
    setNote(null)
    try {
      const signature = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL)
      const bh = await connection.getLatestBlockhash('confirmed')
      await connection.confirmTransaction({ signature, ...bh }, 'confirmed')
      await refresh()
      setNote('Added 2 SOL of test money.')
    } catch {
      setNote(
        IS_DEVNET
          ? 'The devnet faucet refused — it rate-limits by IP. Try faucet.solana.com instead.'
          : 'The local validator refused the airdrop. Is it still running?',
      )
    } finally {
      setBusy(false)
    }
  }, [connection, publicKey, refresh])

  if (!publicKey) return null

  const isLow = lamports !== null && lamports < LOW_BALANCE_LAMPORTS

  return (
    <div className="balance">
      <div className="balance-row">
        <span className={`balance-amount ${isLow ? 'balance-low' : ''}`}>
          {lamports === null ? '…' : formatSol(lamports, 3)}
        </span>
        <button className="link-button" onClick={() => void getTestSol()} disabled={busy}>
          {busy ? 'Adding…' : 'Get test SOL'}
        </button>
      </div>
      {isLow && (
        <p className="balance-warning">
          This wallet has almost no SOL on the {CLUSTER_LABEL}. Click “Get test SOL” before
          creating a campaign or contributing.
          {IS_DEVNET && (
            <>
              {' '}
              If the faucet refuses,{' '}
              <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
                faucet.solana.com
              </a>{' '}
              has a separate limit.
            </>
          )}
        </p>
      )}
      {note && <p className="balance-warning">{note}</p>}
    </div>
  )
}
