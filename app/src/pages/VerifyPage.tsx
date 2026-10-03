import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { SystemProgram, type Transaction } from '@solana/web3.js'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ReviewPanel, type ReviewView } from '../components/ReviewPanel'
import { TxResult } from '../components/TxResult'
import { VERIFICATION_ACCOUNT_SPACE, accountDeposit, networkFee } from '../lib/fees'
import { DEMO_VERIFIER, useVerification, verificationPda } from '../lib/kyc'
import { useProgram } from '../lib/program'
import { sendTransaction, type TxOutcome } from '../lib/send'

/**
 * Identity verification, which unlocks public campaigns. The form is a mock:
 * nothing typed here is stored, sent or written on chain. Submitting has the
 * public demo verifier co-sign `verify_identity`, which the program checks.
 */
export function VerifyPage() {
  const program = useProgram()
  const { connection } = useConnection()
  const wallet = useWallet()
  const { status, reload } = useVerification()

  const [fullName, setFullName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [country, setCountry] = useState('')
  const [consent, setConsent] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ transaction: Transaction; view: ReviewView } | null>(null)
  const [outcome, setOutcome] = useState<TxOutcome | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setOutcome(null)
    if (!wallet.publicKey) return
    if (!fullName.trim() || !birthDate || !country.trim()) {
      setFormError('Fill in your name, date of birth and country.')
      return
    }
    if (!consent) {
      setFormError('Tick the box to confirm you understand this is a demo.')
      return
    }

    setBusy(true)
    try {
      const me = wallet.publicKey
      const transaction = await program.methods
        .verifyIdentity()
        .accountsPartial({
          wallet: me,
          verifier: DEMO_VERIFIER.publicKey,
          verification: verificationPda(me),
          systemProgram: SystemProgram.programId,
        })
        .transaction()
      const [fee, deposit] = await Promise.all([
        networkFee(connection, transaction, me),
        accountDeposit(connection, VERIFICATION_ACCOUNT_SPACE),
      ])
      setPending({
        transaction,
        view: {
          heading: 'Review your verification',
          parties: [
            { label: 'Wallet being verified', address: me.toBase58() },
            { label: 'Verifier (public demo key)', address: DEMO_VERIFIER.publicKey.toBase58() },
          ],
          lines: [
            {
              label: 'Verification record deposit',
              lamports: deposit,
              direction: 'out',
              note: 'Keeps the record on chain. It stores only your wallet and the time — no personal data.',
            },
            { label: 'Network fee', lamports: fee, direction: 'out' },
          ],
          facts: [
            'Once verified, this wallet can open public campaigns. The record cannot be moved to another wallet.',
            'Nothing you typed above is sent anywhere or written on chain.',
          ],
          confirmLabel: 'Confirm and verify',
        },
      })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not prepare the transaction.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!pending || !wallet.publicKey || !wallet.signTransaction) return
    setBusy(true)
    try {
      const result = await sendTransaction(
        connection,
        { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
        pending.transaction,
        // The verifier co-signs after the wallet, like a private campaign's invite.
        { extraSigners: [DEMO_VERIFIER] },
      )
      setOutcome(result)
      setPending(null)
      if (result.kind === 'success') reload()
    } finally {
      setBusy(false)
    }
  }

  if (!wallet.connected) {
    return (
      <section className="panel">
        <h1>Verify your identity</h1>
        <p>Connect a wallet to continue.</p>
        <WalletMultiButton />
      </section>
    )
  }

  if (status === 'verified') {
    return (
      <section className="panel">
        <h1>Verify your identity</h1>
        <div className="notice notice-success">
          <strong>This wallet is verified.</strong>
          <p>You can now open public crowdfunding campaigns.</p>
          <Link to="/new">Start a campaign →</Link>
        </div>
        {outcome && <TxResult outcome={outcome} />}
      </section>
    )
  }

  return (
    <section className="panel">
      <h1>Verify your identity</h1>
      <p className="aside">
        Public crowdfunding takes money from strangers, so its organizers must verify who they are.
        Private campaigns for friends do not need this.
      </p>

      <div className="notice notice-blocked">
        <strong>This is a demo verification.</strong>
        <p>
          No documents are checked, and nothing you type here leaves this page. A public demo key
          signs the verification. What is real is the rule: the on-chain program refuses a public
          campaign from a wallet that has not been verified.
        </p>
      </div>

      {status === 'unknown' ? (
        <p className="empty">Checking your wallet…</p>
      ) : (
        <form onSubmit={submit} onChange={() => setPending(null)} className="form">
          <label>
            <span>Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </label>
          <label>
            <span>Date of birth</span>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              autoComplete="bday"
            />
          </label>
          <label>
            <span>Country</span>
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              autoComplete="country-name"
            />
          </label>
          <label className="choice">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I understand this is a demo and no real identity check takes place.</span>
          </label>

          {formError && <p className="notice notice-error">{formError}</p>}
          {outcome && <TxResult outcome={outcome} onDismiss={() => setOutcome(null)} />}

          {pending ? (
            <ReviewPanel
              view={pending.view}
              busy={busy}
              onConfirm={() => void confirm()}
              onBack={() => setPending(null)}
            />
          ) : (
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Preparing…' : 'Review verification'}
            </button>
          )}
        </form>
      )}
    </section>
  )
}
