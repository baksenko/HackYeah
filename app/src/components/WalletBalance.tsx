import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useCallback, useEffect, useState } from 'react'

import { CLUSTER_LABEL, IS_DEVNET, RPC_ENDPOINT } from '../lib/cluster'
import { formatSol, formatUsdc } from '../lib/format'
import { tokenAccountOf } from '../lib/program'
import { sendTransaction } from '../lib/send'
import { CAN_MINT_TEST_USDC, DEVNET_USDC_FAUCET, mintTestUsdc } from '../lib/testUsdc'

/** How much test USDC one click adds on a local validator. */
const TEST_USDC_AMOUNT = 500n * 1_000_000n

/** Below this, a wallet cannot realistically pay for a campaign plus fees. */
const LOW_BALANCE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL

/**
 * Shows what the connected wallet actually holds *on the cluster this app is
 * talking to* -- USDC to contribute, SOL to pay network fees -- and offers
 * test money when it is short.
 *
 * This exists because the most confusing failure for a newcomer is a wallet
 * that looks funded in Phantom but is empty here — Phantom displays whichever
 * network it is set to, which is not necessarily the one this app uses.
 */
export function WalletBalance() {
  const { connection } = useConnection()
  const { publicKey, signTransaction } = useWallet()

  const [lamports, setLamports] = useState<number | null>(null)
  /** USDC base units; 0 when the wallet has no USDC account yet. */
  const [usdc, setUsdc] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!publicKey) {
      setLamports(null)
      setUsdc(null)
      return
    }
    try {
      setLamports(await connection.getBalance(publicKey, 'confirmed'))
    } catch {
      setLamports(null)
    }
    try {
      const balance = await connection.getTokenAccountBalance(tokenAccountOf(publicKey), 'confirmed')
      setUsdc(BigInt(balance.value.amount))
    } catch {
      setUsdc(0n) // no USDC account yet
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

  const getTestUsdc = useCallback(async () => {
    if (!publicKey || !signTransaction) return
    setBusy(true)
    setNote(null)
    try {
      const { transaction, signer } = mintTestUsdc(publicKey, TEST_USDC_AMOUNT)
      const result = await sendTransaction(connection, { publicKey, signTransaction }, transaction, {
        extraSigners: [signer],
      })
      await refresh()
      setNote(
        result.kind === 'success'
          ? `Added ${formatUsdc(TEST_USDC_AMOUNT)} of test money.`
          : `Could not add test USDC: ${result.failure.plain}`,
      )
    } finally {
      setBusy(false)
    }
  }, [connection, publicKey, signTransaction, refresh])

  if (!publicKey) return null

  const isLow = lamports !== null && lamports < LOW_BALANCE_LAMPORTS
  /**
   * Wallet adapters do not tell the page which network the wallet itself is
   * set to, so a wallet that holds exactly nothing here is the best signal we
   * have that it is pointed somewhere else.
   */
  const isEmpty = lamports === 0

  return (
    <div className="balance">
      <div className="balance-row">
        <span className="balance-amount">{usdc === null ? '…' : formatUsdc(usdc)}</span>
        {CAN_MINT_TEST_USDC ? (
          <button className="link-button" onClick={() => void getTestUsdc()} disabled={busy}>
            {busy ? 'Adding…' : 'Get test USDC'}
          </button>
        ) : (
          IS_DEVNET && (
            <a href={DEVNET_USDC_FAUCET} target="_blank" rel="noreferrer">
              Get devnet USDC
            </a>
          )
        )}
        <span className={`balance-amount balance-sol ${isLow ? 'balance-low' : ''}`}>
          {lamports === null ? '…' : formatSol(lamports, 3)}
          <small> for fees</small>
        </span>
        <button className="link-button" onClick={() => void getTestSol()} disabled={busy}>
          {busy ? 'Adding…' : 'Get test SOL'}
        </button>
      </div>
      {isEmpty && (
        <div className="notice notice-blocked">
          <strong>Your wallet has no SOL on the {CLUSTER_LABEL}.</strong>
          <p>
            If your wallet app shows a balance, it is probably set to a different network than
            this page, and that balance does not exist here. This page cannot see your
            wallet&apos;s network setting, so please check it:
          </p>
          <p>
            In Phantom: Settings → Developer Settings → Testnet Mode, then set Solana to{' '}
            <strong>{IS_DEVNET ? 'Devnet' : `Localnet (${RPC_ENDPOINT})`}</strong>. Solflare has the
            same option in its network settings.
          </p>
          <p>Then click “Get test SOL” above.</p>
        </div>
      )}
      {isLow && !isEmpty && (
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
