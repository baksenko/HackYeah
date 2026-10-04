import { BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey } from '@solana/web3.js'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Address } from '../components/Address'
import { ReviewPanel, type ReviewView } from '../components/ReviewPanel'
import { TxResult } from '../components/TxResult'
import { CAMPAIGN_ACCOUNT_SPACE, TOKEN_ACCOUNT_SPACE, accountDeposit, networkFee } from '../lib/fees'
import { encodeInvite, rememberInvite } from '../lib/invite'
import {
  MAX_DESCRIPTION_BYTES,
  MAX_IMAGE_URL_BYTES,
  MAX_MEMO_BYTES,
  MAX_TITLE_BYTES,
  campaignPda,
  useProgram,
} from '../lib/program'
import { MAX_TAGS, encodeTags, tagsForScope, type Tag } from '../lib/tags'
import { sendTransaction, type TxOutcome } from '../lib/send'
import { formatUsdc, parseUsdc } from '../lib/format'
import { looksLikeSolanaPay, parseSolanaPayUrl, type PaymentRequest } from '../lib/solanaPay'
import { USDC_MINT } from '../lib/program'
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
  /** In USDC base units. */
  goal: BN
  seconds: number
  recipientKey: PublicKey
  /** From a pasted Solana Pay link; stored on the campaign, carried by the payout. */
  reference: PublicKey | null
  memo: string
  invite: Keypair | null
  tags: number
  description: string
  imageUrl: string
  view: ReviewView
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** A fresh id per campaign so one organizer can run many of them. */
const freshCampaignId = () => BigInt(Date.now())

/** Mirrors the program's rule: empty, or a link starting with https://. */
const isAllowedImageUrl = (url: string) => url === '' || /^https:\/\/\S+$/.test(url)

export function CreateCampaignPage() {
  const program = useProgram()
  const { connection } = useConnection()
  const wallet = useWallet()
  const navigate = useNavigate()
  const now = useChainClock()

  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [tags, setTags] = useState<Tag[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  const [goal, setGoal] = useState('1')
  const [preset, setPreset] = useState<number>(PRESETS[0].seconds)
  const [customMinutes, setCustomMinutes] = useState('30')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<TxOutcome | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const titleBytes = byteLength(title)
  const descriptionBytes = byteLength(description.trim())
  const trimmedImageUrl = imageUrl.trim()
  const imageUrlValid = isAllowedImageUrl(trimmedImageUrl) && byteLength(trimmedImageUrl) <= MAX_IMAGE_URL_BYTES
  const connectedKey = wallet.publicKey?.toBase58() ?? ''

  /** A pasted Solana Pay link, parsed; or the reason it could not be. */
  const payment: { request: PaymentRequest } | { error: string } | null = (() => {
    if (!looksLikeSolanaPay(recipient)) return null
    try {
      return { request: parseSolanaPayUrl(recipient) }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That Solana Pay link could not be read.' }
    }
  })()
  const paymentRequest = payment && 'request' in payment ? payment.request : null

  /** The address that will actually be written, or null while it is not a valid key. */
  const resolvedRecipient = (() => {
    if (paymentRequest) return paymentRequest.recipient.toBase58()
    if (payment) return null
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
        d.goal,
        new BN(nowSeconds + d.seconds),
        d.recipientKey,
        d.invite?.publicKey ?? null,
        d.tags,
        d.description,
        d.imageUrl,
        d.reference,
        d.memo,
      )
      // The USDC mint and the campaign's vault are fixed by the program and
      // resolved from the IDL.
      .accountsPartial({ organizer, campaign: d.campaign })
      .transaction()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)
    setOutcome(null)

    if (!wallet.publicKey || !wallet.signTransaction) {
      setFormError('Connect a wallet first.')
      return
    }

    let goalUnits: BN
    try {
      goalUnits = parseUsdc(goal)
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
    if (descriptionBytes > MAX_DESCRIPTION_BYTES) {
      setFormError(`The description is ${descriptionBytes} bytes; the program allows ${MAX_DESCRIPTION_BYTES}.`)
      return
    }
    if (!imageUrlValid) {
      setFormError(`The photo link must start with https:// and be at most ${MAX_IMAGE_URL_BYTES} bytes.`)
      return
    }

    const seconds = preset === 0 ? Math.round(Number(customMinutes) * 60) : preset
    if (!Number.isFinite(seconds) || seconds <= 0) {
      setFormError('Choose a deadline in the future.')
      return
    }

    if (payment && 'error' in payment) {
      setFormError(payment.error)
      return
    }
    if (paymentRequest?.memo && byteLength(paymentRequest.memo) > MAX_MEMO_BYTES) {
      setFormError(`The shop's memo is ${byteLength(paymentRequest.memo)} bytes; the program allows ${MAX_MEMO_BYTES}.`)
      return
    }
    let recipientKey: PublicKey
    try {
      recipientKey = paymentRequest
        ? paymentRequest.recipient
        : recipient.trim()
          ? new PublicKey(recipient.trim())
          : wallet.publicKey
    } catch {
      setFormError('That recipient address is not a valid Solana address.')
      return
    }

    const campaignId = freshCampaignId()
    const next: Omit<Draft, 'view'> = {
      campaignId,
      campaign: campaignPda(wallet.publicKey, campaignId),
      title: title.trim(),
      goal: goalUnits,
      seconds,
      recipientKey,
      reference: paymentRequest?.references[0] ?? null,
      memo: paymentRequest?.memo ?? '',
      // A private campaign gets a fresh invite key. Only its public half goes
      // on chain; the secret half becomes the share link.
      invite: visibility === 'private' ? Keypair.generate() : null,
      tags: encodeTags(tags),
      description: description.trim(),
      imageUrl: trimmedImageUrl,
    }

    setBusy(true)
    try {
      const organizer = wallet.publicKey
      const [fee, deposit, vaultDeposit] = await Promise.all([
        build(next, organizer, now).then((tx) => networkFee(connection, tx, organizer)),
        accountDeposit(connection, CAMPAIGN_ACCOUNT_SPACE),
        accountDeposit(connection, TOKEN_ACCOUNT_SPACE),
      ])
      setDraft({
        ...next,
        view: {
          heading: 'Review your campaign',
          parties: [
            { label: 'Recipient (locked by the first contribution)', address: recipientKey.toBase58() },
            { label: 'New campaign account that will hold the money', address: next.campaign.toBase58() },
          ],
          lines: [
            {
              label: 'Campaign account deposit',
              asset: 'sol',
              amount: deposit,
              direction: 'out',
              note: 'Kept in the campaign account while it exists. The program can return it to you once everything is settled, but this app has no button for that yet.',
            },
            {
              label: 'Vault deposit',
              asset: 'sol',
              amount: vaultDeposit,
              direction: 'out',
              note: "Opens the campaign's own USDC account, which holds the money. Returned with the campaign deposit.",
            },
            { label: 'Network fee', asset: 'sol', amount: fee, direction: 'out' },
          ],
          facts: [
            'The name, goal, deadline, tags and who can join can never be changed after this, not by you and not by us.',
            'Until anyone contributes, you can still correct the recipient. The first contribution locks it for good.',
            `Goal: ${formatUsdc(goalUnits)}. The deadline is counted from the moment you confirm.`,
            'Creating the campaign moves none of your money apart from the deposit and the fee.',
            ...(next.imageUrl
              ? ['Only the photo link is fixed. Whoever hosts the image could still change or remove it.']
              : []),
            ...(next.reference || next.memo
              ? ["The shop's payment reference and memo are stored with the campaign. Every payout carries them, so the shop can confirm it has been paid."]
              : []),
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

        <label>
          <span>Tell people what it is for</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder={
              visibility === 'private'
                ? 'Shared deposit for the campervan and the first two nights.'
                : 'What the money pays for, who it helps, and why it matters.'
            }
          />
          <small className={descriptionBytes > MAX_DESCRIPTION_BYTES ? 'warn' : ''}>
            Optional. {descriptionBytes}/{MAX_DESCRIPTION_BYTES} bytes — letters like ą or ł count
            as two.
          </small>
        </label>

        <label>
          <span>Photo link</span>
          <input
            value={imageUrl}
            onChange={(e) => {
              setImageUrl(e.target.value)
              setImageFailed(false)
            }}
            placeholder="https://…/photo.jpg"
            inputMode="url"
            spellCheck={false}
          />
          <small className={imageUrlValid ? '' : 'warn'}>
            Optional. A link to an image hosted anywhere, starting with https://. Only the link is
            saved on chain.
          </small>
        </label>
        {trimmedImageUrl && imageUrlValid && (
          <figure className="photo-preview">
            {imageFailed ? (
              <p className="notice notice-error">This link does not open as an image.</p>
            ) : (
              <img
                src={trimmedImageUrl}
                alt="Preview of the campaign photo"
                referrerPolicy="no-referrer"
                onError={() => setImageFailed(true)}
              />
            )}
          </figure>
        )}

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
          <span>How much do you need, in USDC?</span>
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
            A wallet address, or a store&apos;s Solana Pay payment link (it starts with
            &quot;solana:&quot;). Leave it empty to use your own wallet. Once anyone contributes, the
            recipient is locked, so the money can never be sent anywhere else.
          </small>
        </label>

        {payment && 'error' in payment && <p className="notice notice-error">{payment.error}</p>}
        {paymentRequest && (
          <div className="notice">
            <strong>
              Solana Pay request{paymentRequest.label ? ` from ${paymentRequest.label}` : ''}
            </strong>
            {paymentRequest.message && <p>{paymentRequest.message}</p>}
            {paymentRequest.splToken && !paymentRequest.splToken.equals(USDC_MINT) && (
              <p className="warn">
                This request asks for a different token than USDC. The campaign can only pay out
                USDC, so check with the store that they accept it.
              </p>
            )}
            {paymentRequest.amount && !paymentRequest.splToken && (
              <p className="warn">
                This request is priced in SOL ({paymentRequest.amount} SOL), but campaigns raise
                USDC. Set the goal in USDC yourself.
              </p>
            )}
            {paymentRequest.amount && paymentRequest.splToken?.equals(USDC_MINT) && (
              <p>
                It asks for {paymentRequest.amount} USDC.{' '}
                {goal.trim() !== paymentRequest.amount && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setGoal(paymentRequest.amount!)
                      setDraft(null)
                    }}
                  >
                    Use it as the goal
                  </button>
                )}
              </p>
            )}
            {(paymentRequest.references[0] || paymentRequest.memo) && (
              <p className="aside">
                Its {paymentRequest.references[0] ? 'reference' : ''}
                {paymentRequest.references[0] && paymentRequest.memo ? ' and ' : ''}
                {paymentRequest.memo ? `memo (“${paymentRequest.memo}”)` : ''} will be stored with the
                campaign, and the payout always carries them — whoever sends it — so the shop can
                confirm it has been paid.
              </p>
            )}
          </div>
        )}

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
          recipient.trim() && !payment && (
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
