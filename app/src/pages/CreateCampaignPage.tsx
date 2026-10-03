import { BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Address } from '../components/Address'
import { ReviewPanel, type ReviewView } from '../components/ReviewPanel'
import { TxResult } from '../components/TxResult'
import { CAMPAIGN_ACCOUNT_SPACE, accountDeposit, networkFee } from '../lib/fees'
import { encodeInvite, rememberInvite } from '../lib/invite'
import { MAX_TITLE_BYTES, campaignPda, useProgram } from '../lib/program'
import { MAX_TAGS, encodeTags, tagsForScope, type Tag } from '../lib/tags'
import { sendTransaction, type TxOutcome } from '../lib/send'
import { formatSol, solToLamports } from '../lib/format'
import { useChainClock } from '../lib/useChainClock'

const PRESETS = [
  { label: '2 minutes (demo)', seconds: 120 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86_400 },
  { label: '1 week', seconds: 604_800 },
  { label: 'Custom…', seconds: 0 },
] as const

/** A validated campaign waiting for the organizer to confirm its costs. */
type Draft = {
  campaignId: bigint
  campaign: PublicKey
  title: string
  goalLamports: BN
  seconds: number
  recipientKey: PublicKey
  invite: Keypair | null
  tags: number
  view: ReviewView
}

export function CreateCampaignPage() {
  const program = useProgram()
  const { connection } = useConnection()
  const wallet = useWallet()
  const navigate = useNavigate()
  const now = useChainClock()

  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [tags, setTags] = useState<Tag[]>([])
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('1')
  const [preset, setPreset] = useState<number>(PRESETS[0].seconds)
  const [customMinutes, setCustomMinutes] = useState('30')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<TxOutcome | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const titleBytes = new TextEncoder().encode(title).length
  const connectedKey = wallet.publicKey?.toBase58() ?? ''

  /** The address that will actually be written, or null while it is not a valid key. */
  const resolvedRecipient = (() => {
    if (!recipient.trim()) return connectedKey || null
    try {
      return new PublicKey(recipient.trim()).toBase58()
    } catch {
      return null
    }
  })()

  const build = (d: Omit<Draft, 'view'>, organizer: PublicKey, nowSeconds: number) =>
    program.methods
      .createCampaign(
        new BN(d.campaignId.toString()),
        d.title,
        d.goalLamports,
        new BN(nowSeconds + d.seconds),
        d.recipientKey,
        d.invite?.publicKey ?? null,
        d.tags,
      )
      .accountsPartial({
        organizer,
        campaign: d.campaign,
        systemProgram: SystemProgram.programId,
      })
      .transaction()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setOutcome(null)

    if (!wallet.publicKey || !wallet.signTransaction) {
      setFormError('Connect a wallet first.')
      return
    }

    let goalLamports: BN
    try {
      goalLamports = solToLamports(goal)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Enter a valid goal.')
      return
    }

    if (!title.trim()) {
      setFormError('Give the campaign a name.')
      return
    }
    if (titleBytes > MAX_TITLE_BYTES) {
      setFormError(`The name is ${titleBytes} bytes; the program allows ${MAX_TITLE_BYTES}.`)
      return
    }

    const seconds = preset === 0 ? Math.round(Number(customMinutes) * 60) : preset
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setFormError('Choose a deadline in the future.')
      return
    }

    let recipientKey: PublicKey
    try {
      recipientKey = recipient.trim() ? new PublicKey(recipient.trim()) : wallet.publicKey
    } catch {
      setFormError('That recipient address is not a valid Solana address.')
      return
    }

    // A fresh id per campaign so one organizer can run many of them.
    const campaignId = BigInt(Date.now())
    const next: Omit<Draft, 'view'> = {
      campaignId,
      campaign: campaignPda(wallet.publicKey, campaignId),
      title: title.trim(),
      goalLamports,
      seconds,
      recipientKey,
      // A private campaign gets a fresh invite key. Only its public half goes
      // on chain; the secret half becomes the share link.
      invite: visibility === 'private' ? Keypair.generate() : null,
      tags: encodeTags(tags),
    }

    setBusy(true)
    try {
      const organizer = wallet.publicKey
      const [fee, deposit] = await Promise.all([
        build(next, organizer, now).then((tx) => networkFee(connection, tx, organizer)),
        accountDeposit(connection, CAMPAIGN_ACCOUNT_SPACE),
      ])
      setDraft({
        ...next,
        view: {
          heading: 'Review your campaign',
          parties: [
            { label: 'Recipient, fixed forever', address: recipientKey.toBase58() },
            { label: 'New campaign account that will hold the money', address: next.campaign.toBase58() },
          ],
          lines: [
            {
              label: 'Campaign account deposit',
              lamports: deposit,
              direction: 'out',
              note: 'Kept in the campaign account while it exists. The program can return it to you once everything is settled, but this app has no button for that yet.',
            },
            { label: 'Network fee', lamports: fee, direction: 'out' },
          ],
          facts: [
            'The name, goal, deadline, recipient, tags and who can join can never be changed after this, not by you and not by us.',
            `Goal: ${formatSol(goalLamports)}. The deadline is counted from the moment you confirm.`,
            'Creating the campaign moves none of your money apart from the deposit and the fee.',
          ],
          confirmLabel: 'Confirm and create campaign',
        },
      })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not prepare the transaction.')
    } finally {
      setBusy(false)
    }
  }

  /** Signs and sends exactly what was reviewed, with the deadline counted from now. */
  async function confirm() {
    if (!draft || !wallet.publicKey || !wallet.signTransaction) return
    setBusy(true)
    try {
      const result = await sendTransaction(
        connection,
        { publicKey: wallet.publicKey, signTransaction: wallet.signTransaction },
        await build(draft, wallet.publicKey, now),
      )
      setOutcome(result)
      setDraft(null)
      if (result.kind === 'success') {
        if (draft.invite) {
          rememberInvite(draft.campaign, draft.invite)
          navigate(`/c/${draft.campaign.toBase58()}#invite=${encodeInvite(draft.invite)}`)
        } else {
          navigate(`/c/${draft.campaign.toBase58()}`)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  if (!wallet.connected) {
    return (
      <section className="panel">
        <h1>Create a campaign</h1>
        <p>Connect a wallet to continue.</p>
        <WalletMultiButton />
      </section>
    )
  }

  return (
    <section className="panel">
      <h1>Create a campaign</h1>
      <p className="aside">
        Everything you set here is written into the campaign once and can never be edited
        afterwards — not by you, not by us.
      </p>

      {/*
        Editing any field discards the review, so what is signed always matches
        the form. Inputs reach this through onChange; the visibility and tag
        buttons clear it themselves.
      */}
      <form onSubmit={submit} onChange={() => setDraft(null)} className="form">
        <div className="visibility">
          <button
            type="button"
            className={`visibility-option ${visibility === 'private' ? 'selected' : ''}`}
            onClick={() => {
              setVisibility('private')
              setTags([])
              setDraft(null)
            }}
          >
            <span className="visibility-icon">🔒</span>
            <strong>Private — for friends</strong>
            <small>
              A trip, a gift, a shared flat. Only people you send the link or QR code to can
              chip in. Not listed publicly.
            </small>
          </button>
          <button
            type="button"
            className={`visibility-option ${visibility === 'public' ? 'selected' : ''}`}
            onClick={() => {
              setVisibility('public')
              setTags([])
              setDraft(null)
            }}
          >
            <span className="visibility-icon">🌍</span>
            <strong>Public — crowdfunding</strong>
            <small>
              A cause or community project. Listed for everyone, and anyone can contribute.
            </small>
          </button>
        </div>

        <label>
          <span>What is it for?</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={visibility === 'private' ? 'Trip to New Zealand' : 'New playground for our street'}
            maxLength={120}
          />
          <small className={titleBytes > MAX_TITLE_BYTES ? 'warn' : ''}>
            {titleBytes}/{MAX_TITLE_BYTES} characters
          </small>
        </label>

        <fieldset>
          <legend>Tags — pick up to {MAX_TAGS}</legend>
          <div className="choices">
            {tagsForScope(visibility).map((tag) => {
              const on = tags.some((t) => t.bit === tag.bit)
              const full = !on && tags.length >= MAX_TAGS
              return (
                <button
                  key={tag.slug}
                  type="button"
                  className={`chip ${on ? 'chip-on' : ''}`}
                  aria-pressed={on}
                  disabled={full}
                  onClick={() => {
                    setTags((cur) => (on ? cur.filter((t) => t.bit !== tag.bit) : [...cur, tag]))
                    setDraft(null)
                  }}
                >
                  {tag.emoji} {tag.label}
                </button>
              )
            })}
          </div>
          <small>
            Tags help people find {visibility === 'public' ? 'your cause' : 'and organise your campaigns'}{' '}
            in search. Like everything else, they are fixed once the campaign is created.
          </small>
        </fieldset>

        <label>
          <span>How much do you need, in SOL?</span>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            inputMode="decimal"
            placeholder="1"
          />
          <small>If this much is not collected in time, everyone gets their money back.</small>
        </label>

        <fieldset>
          <legend>How long is it open?</legend>
          <div className="choices">
            {PRESETS.map((option) => (
              <label key={option.label} className="choice">
                <input
                  type="radio"
                  name="deadline"
                  checked={preset === option.seconds}
                  onChange={() => setPreset(option.seconds)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          {preset === 0 && (
            <label>
              <span>Minutes from now</span>
              <input
                value={customMinutes}
                onChange={(e) => setCustomMinutes(e.target.value)}
                inputMode="numeric"
              />
            </label>
          )}
        </fieldset>

        <label>
          <span>Who receives the money if the goal is reached?</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={connectedKey}
            spellCheck={false}
          />
          <small>
            Leave it empty to use your own wallet. This address is fixed when the campaign is
            created, so the money can never be sent anywhere else.
          </small>
        </label>

        {resolvedRecipient ? (
          <div className={`notice ${resolvedRecipient === connectedKey ? '' : 'notice-blocked'}`}>
            <strong>
              {resolvedRecipient === connectedKey
                ? 'The money will go to your connected wallet:'
                : 'The money will go to this address — not your connected wallet. Check every character:'}
            </strong>
            <Address address={resolvedRecipient} />
          </div>
        ) : (
          recipient.trim() && (
            <p className="notice notice-error">That is not a valid Solana address yet.</p>
          )
        )}

        {formError && <p className="notice notice-error">{formError}</p>}
        {outcome && <TxResult outcome={outcome} onDismiss={() => setOutcome(null)} />}

        {draft ? (
          <ReviewPanel
            view={draft.view}
            busy={busy}
            onConfirm={() => void confirm()}
            onBack={() => setDraft(null)}
          />
        ) : (
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? 'Preparing…' : 'Review and create'}
          </button>
        )}
      </form>
    </section>
  )
}
