import { BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey, type Transaction } from '@solana/web3.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { Address } from '../components/Address'
import { CampaignPhoto } from '../components/CampaignPhoto'
import { Progress } from '../components/Progress'
import { ReviewPanel, type ReviewView } from '../components/ReviewPanel'
import { SharePanel } from '../components/SharePanel'
import { StatusBadge } from '../components/StatusBadge'
import { TagChip } from '../components/TagChip'
import { TxResult } from '../components/TxResult'
import {
  campaignStatus,
  isPrivate,
  refundsOpen,
  secondsLeft,
  type Campaign,
  type Contribution,
} from '../lib/campaign'
import { buildContributeTransaction, buildWithdrawTransaction } from '../lib/actions'
import { CLUSTER_LABEL } from '../lib/cluster'
import { PERMISSIONS, whatCanHappenNow } from '../lib/explain'
import { CONTRIBUTION_ACCOUNT_SPACE, TOKEN_ACCOUNT_SPACE, accountDeposit, networkFee } from '../lib/fees'
import { formatCountdown, formatDateTime, formatUsdc, parseUsdc, usdcInputValue } from '../lib/format'
import { useCampaignIndex } from '../lib/indexer'
import { buildLeaderboard } from '../lib/leaderboard'
import {
  inviteFromHash,
  recallInvite,
  recallNickname,
  rememberInvite,
  rememberNickname,
} from '../lib/invite'
import { USDC_MINT, contributionPda, tokenAccountOf, useProgram, vaultOf } from '../lib/program'
import { decodeTags } from '../lib/tags'
import { sendTransaction, type TxOutcome } from '../lib/send'
import { useChainClock } from '../lib/useChainClock'

type SendOptions = { skipPreflight?: boolean; extraSigners?: Keypair[] }

/** A built transaction waiting for the person to confirm its costs. */
type Pending = {
  key: string
  transaction: Transaction
  options: SendOptions
  view: ReviewView
}

const neverSent = (error: unknown): TxOutcome => ({
  kind: 'never-sent',
  failure: {
    name: 'Unknown',
    message: String(error),
    plain: error instanceof Error ? error.message : 'Something went wrong.',
  },
})

export function CampaignPage() {
  const { address } = useParams<{ address: string }>()
  const program = useProgram()
  const index = useCampaignIndex()
  const { connection } = useConnection()
  const wallet = useWallet()
  const now = useChainClock()

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<TxOutcome | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** What the person typed; null until they type, so the box shows what is still needed. */
  const [amount, setAmount] = useState<string | null>(null)
  const [amountError, setAmountError] = useState<string | null>(null)
  const [nickname, setNickname] = useState(recallNickname)
  const [pending, setPending] = useState<Pending | null>(null)
  const { hash } = useLocation()

  const campaignKey = useMemo(() => {
    try {
      return address ? new PublicKey(address) : null
    } catch {
      return null
    }
  }, [address])

  const load = useCallback(async () => {
    if (!campaignKey) return
    try {
      setLoadError(null)
      const [next, contribs] = await Promise.all([index.campaign(campaignKey), index.contributionsTo(campaignKey)])
      if (!next) {
        setLoadError(`No campaign exists at this address on the ${CLUSTER_LABEL}.`)
        return
      }
      setCampaign(next)
      setContributions(contribs)
    } catch {
      setLoadError(`Could not read this campaign from the ${CLUSTER_LABEL}. Check your connection and refresh.`)
    }
  }, [index, campaignKey])

  useEffect(() => {
    void load()
  }, [load])

  // The invite for a private campaign: from the link just opened, or one this
  // browser already remembered. Kept only if it matches what is on chain.
  const linkInvite = useMemo(() => inviteFromHash(hash), [hash])
  useEffect(() => {
    if (campaignKey && linkInvite && campaign?.invite?.equals(linkInvite.publicKey)) {
      rememberInvite(campaignKey, linkInvite)
    }
  }, [campaignKey, linkInvite, campaign])

  if (!campaignKey) return <p className="empty">That is not a valid campaign address.</p>
  if (loadError) return <p className="notice notice-error">{loadError}</p>
  if (!campaign) return <p className="empty">Reading the chain…</p>

  const status = campaignStatus(campaign, now)
  const left = secondsLeft(campaign, now)
  const me = wallet.publicKey
  const isOrganizer = !!me && me.equals(campaign.organizer)
  const isRecipient = !!me && me.equals(campaign.recipient)
  const myContribution = contributions.find((c) => !!me && c.contributor.equals(me)) ?? null

  const privateCampaign = isPrivate(campaign)
  const candidateInvite: Keypair | null = linkInvite ?? recallInvite(campaignKey)
  const invite =
    privateCampaign && candidateInvite && campaign.invite!.equals(candidateInvite.publicKey)
      ? candidateInvite
      : null
  const wrongInvite = privateCampaign && !!linkInvite && !invite

  const explanation = whatCanHappenNow(campaign, status, {
    isConnected: wallet.connected,
    isOrganizer,
    isRecipient,
    myContribution,
  })

  /**
   * Builds one action's transaction and shows what it will cost. Nothing is
   * signed here -- the wallet is only asked once the person confirms.
   */
  async function review(
    key: string,
    build: () => Promise<Transaction>,
    describe: (networkFeeLamports: number) => Promise<ReviewView>,
    options: SendOptions = {},
  ) {
    if (!me) return
    setOutcome(null)
    setBusy(key)
    try {
      const transaction = await build()
      const networkFeeLamports = await networkFee(connection, transaction, me)
      setPending({ key, transaction, options, view: await describe(networkFeeLamports) })
    } catch (error) {
      setOutcome(neverSent(error))
    } finally {
      setBusy(null)
    }
  }

  /** Signs and sends the reviewed transaction, then refreshes from the chain. */
  async function confirm() {
    if (!pending || !me || !wallet.signTransaction) return
    setBusy(pending.key)
    try {
      const result = await sendTransaction(
        connection,
        { publicKey: me, signTransaction: wallet.signTransaction },
        pending.transaction,
        pending.options,
      )
      setOutcome(result)
      // After a contribution, offer the new remaining amount again.
      if (pending.key === 'contribute' && result.kind === 'success') setAmount(null)
      setPending(null)
      await load()
    } catch (error) {
      setOutcome(neverSent(error))
      setPending(null)
    } finally {
      setBusy(null)
    }
  }

  /** While a review is being prepared or sent, the button that started it says so. */
  const buttonLabel = (key: string, idle: string) =>
    busy === key ? (pending ? 'Sending…' : 'Preparing…') : idle

  const campaignAddress = campaign.address.toBase58()
  const recipientKey = campaign.recipient
  const recipientAddress = recipientKey.toBase58()
  const deadline = campaign.deadline.toNumber()
  const raisedUnits = BigInt(campaign.totalRaised.toString())
  // Contributions stop exactly at the goal (the program refuses more).
  const remainingUnits = BigInt(campaign.goal.toString()) - raisedUnits
  const amountText = amount ?? (remainingUnits > 0n ? usdcInputValue(remainingUnits) : '')
  const hasShopReference = campaign.reference !== null
  // Captured so async callbacks below keep the narrowed (non-null) values.
  const payoutRecipient = campaign.recipient
  const goalUnitsBN = campaign.goal

  // This campaign's own leaderboard: the same ranking as the global one,
  // counting only this campaign's receipts. Refunded receipts are gone already.
  const ranked = buildLeaderboard(contributions, new Set([campaignAddress]))
  const stillHeld = ranked.reduce((sum, r) => sum.add(r.total), new BN(0))
  const sharePercent = (amount: BN) =>
    stillHeld.isZero() ? '—' : `${Math.round((Number(amount.toString()) / Number(stillHeld.toString())) * 100)}%`

  const vault = vaultOf(campaign.address)
  const fee = (amount: number) => ({ label: 'Network fee', asset: 'sol' as const, amount, direction: 'out' as const })
  /** The SOL deposit to open someone's USDC account, if it does not exist yet. */
  const openingDeposit = async (owner: PublicKey, label: string) =>
    (await connection.getAccountInfo(tokenAccountOf(owner)))
      ? []
      : [
          {
            label,
            asset: 'sol' as const,
            amount: await accountDeposit(connection, TOKEN_ACCOUNT_SPACE),
            direction: 'out' as const,
            note: 'A one-time deposit to open a USDC account. It belongs to that account, not to the campaign.',
          },
        ]

  /**
   * `withInvite: false` deliberately leaves the invite out even when this
   * browser has one — that is how the demo proves the program checks it.
   * `expected_recipient` is the recipient this page shows: if the organizer
   * changed it since the page loaded, the program refuses the contribution.
   */
  const buildContribute = async (units: BN, withInvite = true) =>
    buildContributeTransaction(program, {
      campaign: campaign.address,
      expectedRecipient: campaign.recipient,
      contributor: me!,
      amount: units,
      nickname: nickname.trim(),
      invite: withInvite && invite ? invite.publicKey : null,
      // The contribution that completes the goal pays the recipient in the
      // same transaction: a shop gets its order paid the instant the group
      // finishes, with nobody having to press "pay out".
      payout: completesGoal(units)
        ? { recipient: campaign.recipient, reference: campaign.reference, memo: campaign.memo }
        : null,
    })

  const completesGoal = (units: BN) => units.gte(campaign.goal.sub(campaign.totalRaised))

  /**
   * Permissionless: whoever signs, the money only ever goes to the stored
   * recipient. A real payout carries the shop's reference and memo stored on
   * the campaign; the demo carries neither, so it never shows up in a shop's
   * search for its payment (the program refuses it on the goal first).
   */
  const buildWithdraw = async (forReal = true) =>
    buildWithdrawTransaction(program, {
      campaign: campaign.address,
      recipient: campaign.recipient,
      caller: me!,
      reference: forReal ? campaign.reference : null,
      memo: forReal ? campaign.memo : '',
    })

  const buildRefund = async () =>
    program.methods
      .refund()
      .accountsPartial({
        contributor: me!,
        campaign: campaign.address,
        contribution: contributionPda(campaign.address, me!),
        mint: USDC_MINT,
        vault,
        contributorToken: tokenAccountOf(me!),
      })
      .transaction()

  const buildCancel = async () =>
    program.methods.cancel().accountsPartial({ organizer: me!, campaign: campaign.address }).transaction()

  function onContribute() {
    setAmountError(null)
    let units: BN
    try {
      units = parseUsdc(amountText)
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : 'Enter a valid amount.')
      return
    }
    if (BigInt(units.toString()) > remainingUnits) {
      setAmountError(`Only ${formatUsdc(remainingUnits)} is still needed to reach the goal. Contribute that much or less.`)
      return
    }
    const name = nickname.trim()
    if (name) rememberNickname(name)
    void review(
      'contribute',
      () => buildContribute(units),
      async (networkCost) => {
        // The receipt account is created on a first contribution only.
        const deposit = myContribution ? 0 : await accountDeposit(connection, CONTRIBUTION_ACCOUNT_SPACE)
        const completes = completesGoal(units)
        const recipientDeposit = completes
          ? await openingDeposit(payoutRecipient, "Opening the recipient's USDC account")
          : []
        return {
          heading: completes ? 'Review your contribution — it completes the goal' : 'Review your contribution',
          parties: completes
            ? [{ label: 'Paid out right now, in this same transaction, to', address: recipientAddress }]
            : [
                { label: 'Locked in this campaign account', address: campaignAddress },
                { label: 'Paid out to this recipient if the goal is reached', address: recipientAddress },
              ],
          lines: [
            { label: 'Your contribution', asset: 'usdc', amount: Number(units.toString()), direction: 'out' },
            ...(deposit
              ? [
                  {
                    label: 'One-time receipt deposit',
                    asset: 'sol' as const,
                    amount: deposit,
                    direction: 'out' as const,
                    note: 'Returned with your refund if the goal is missed. If the goal is reached it stays locked on chain for good.',
                  },
                ]
              : []),
            ...recipientDeposit,
            fee(networkCost),
          ],
          facts: [
            ...(completes
              ? [
                  `Your contribution completes the goal, so the program pays the whole ${formatUsdc(goalUnitsBN)} to the recipient in this same transaction — nobody has to press “pay out”.` +
                    (hasShopReference
                      ? ' The payment carries the shop’s order reference, so the shop sees the order paid the moment it lands.'
                      : ''),
                ]
              : []),
            'You cannot take this back while the campaign is open, even if you change your mind.',
            `If the goal is missed by ${formatDateTime(deadline)}, or the organizer cancels, you can take back exactly this amount.`,
            'If the goal is reached, it goes to the recipient above and cannot be refunded.',
            name
              ? `The group will see you as “${name}”. Your wallet address is public either way.`
              : 'The group will see your wallet address.',
          ],
          confirmLabel: `Confirm and contribute ${formatUsdc(units)}`,
        }
      },
      { extraSigners: invite ? [invite] : [] },
    )
  }

  function onWithdraw() {
    void review('withdraw', () => buildWithdraw(), async (networkCost) => {
      // The program pays exactly what was contributed (the goal), never the
      // vault balance -- USDC sent to the vault directly is not paid out.
      const held = raisedUnits
      return {
        heading: 'Review: send the money to the recipient',
        parties: [
          { label: 'Paid from this campaign account', address: campaignAddress },
          {
            label: isRecipient ? 'To you, the recipient' : 'To the recipient — and nobody else',
            address: recipientAddress,
          },
        ],
        lines: [
          ...(isRecipient
            ? [{ label: 'Payout to you', asset: 'usdc' as const, amount: Number(held), direction: 'in' as const }]
            : []),
          ...(await openingDeposit(recipientKey, "Opening the recipient's USDC account")),
          fee(networkCost),
        ],
        facts: [
          isRecipient
            ? `${formatUsdc(held)} comes to you.`
            : `${formatUsdc(held)} goes to the recipient above. You pay only the network fee; none of the money passes through your wallet.`,
          'This is final. The program records the payout and refuses a second one.',
          ...(hasShopReference
            ? ["It carries the shop's payment reference, so the shop can confirm it has been paid."]
            : []),
        ],
        confirmLabel: `Send ${formatUsdc(held)} to the recipient`,
      }
    })
  }

  function onRefund() {
    if (!myContribution) return
    void review('refund', buildRefund, async (networkCost) => {
      // Closing the receipt hands back whatever it holds: the deposit paid
      // when it was created.
      const receipt = await connection.getBalance(myContribution.address, 'confirmed')
      return {
        heading: 'Review your refund',
        parties: [
          { label: 'Paid from this campaign account', address: campaignAddress },
          { label: 'To your wallet', address: me!.toBase58() },
        ],
        lines: [
          {
            label: 'Your contribution back',
            asset: 'usdc',
            amount: Number(myContribution.amount.toString()),
            direction: 'in',
          },
          { label: 'Receipt deposit returned', asset: 'sol', amount: receipt, direction: 'in' },
          ...(await openingDeposit(me!, 'Reopening your USDC account')),
          fee(networkCost),
        ],
        facts: ['Your receipt is deleted as it pays out, so a refund can only happen once.'],
        confirmLabel: `Confirm and get ${formatUsdc(myContribution.amount)} back`,
      }
    })
  }

  function onCancel() {
    void review('cancel', buildCancel, async (networkCost) => ({
      heading: 'Review: cancel this campaign',
      parties: [{ label: 'Cancelling this campaign', address: campaignAddress }],
      lines: [fee(networkCost)],
      facts: [
        'This cannot be undone. The campaign stops taking contributions for good.',
        'It moves no money. Every contributor can then take back exactly what they paid in, whenever they like.',
        "Nobody — including you — can ever send this campaign's money to the recipient after this.",
      ],
      confirmLabel: 'Cancel the campaign',
      danger: true,
    }))
  }

  function onDemo() {
    void review(
      'demo',
      () => buildWithdraw(false),
      async (networkCost) => ({
        heading: 'Review: paying out before the goal is reached (demo)',
        parties: [{ label: 'Trying to pay out this campaign account', address: campaignAddress }],
        lines: [{ ...fee(networkCost), note: 'Charged even though the program will reject the transaction.' }],
        facts: [
          'The program will refuse this: the goal has not been reached. No money moves except the fee.',
          'You will get a link to the failed transaction as proof.',
        ],
        confirmLabel: 'Send it anyway',
        danger: true,
      }),
      { skipPreflight: true },
    )
  }

  function onInviteDemo() {
    void review(
      'demo-invite',
      () => buildContribute(parseUsdc('0.01'), false),
      async (networkCost) => ({
        heading: 'Review: contributing without the invite (demo)',
        parties: [{ label: 'Trying to contribute to this campaign account', address: campaignAddress }],
        lines: [{ ...fee(networkCost), note: 'Charged even though the program will reject the transaction.' }],
        facts: [
          'The program will refuse this because the invite key did not sign. The 0.01 USDC never leaves your wallet.',
          'You will get a link to the failed transaction as proof.',
        ],
        confirmLabel: 'Send it anyway',
        danger: true,
      }),
      { skipPreflight: true },
    )
  }

  const reviewPanel = pending && (
    <ReviewPanel
      view={pending.view}
      busy={busy !== null}
      onConfirm={() => void confirm()}
      onBack={() => setPending(null)}
    />
  )

  return (
    <article className="campaign">
      <Link to="/campaigns" className="back">
        ← All campaigns
      </Link>

      <CampaignPhoto url={campaign.imageUrl} title={campaign.title} />

      <header className="campaign-head">
        <div>
          <h1>{campaign.title}</h1>
          <dl className="campaign-sub campaign-parties">
            <dt>For</dt>
            <dd>
              <Address address={recipientAddress} you={isRecipient} explorer />
            </dd>
            <dt>Organised by</dt>
            <dd>
              <Address address={campaign.organizer.toBase58()} you={isOrganizer} explorer />
            </dd>
          </dl>
          {decodeTags(campaign.tags).length > 0 && (
            <div className="tag-row">
              {decodeTags(campaign.tags).map((tag) => (
                <TagChip key={tag.slug} tag={tag} link />
              ))}
            </div>
          )}
        </div>
        <div className="badges">
          <span className={`badge ${privateCampaign ? 'badge-private' : 'badge-public'}`}>
            {privateCampaign ? '🔒 Private' : '🌍 Public'}
          </span>
          <StatusBadge status={status} />
        </div>
      </header>

      {campaign.description && <p className="campaign-description">{campaign.description}</p>}

      <Progress campaign={campaign} />

      <p className="countdown">
        {status === 'open' && (
          <>
            Closes in <strong>{formatCountdown(left)}</strong> — {formatDateTime(deadline)}
          </>
        )}
        {(status === 'succeeded' || status === 'withdrawn') && <>The goal was reached.</>}
        {status === 'failed' && <>Closed on {formatDateTime(deadline)} without reaching the goal.</>}
        {status === 'cancelled' && <>Cancelled by the organizer.</>}
      </p>

      {wrongInvite && (
        <p className="notice notice-error">
          The invite in this link belongs to a different campaign, so it will not let you
          contribute here. Ask the organizer for the right link.
        </p>
      )}

      {(!privateCampaign || invite) && (
        <SharePanel campaign={campaign.address} title={campaign.title} invite={invite} />
      )}

      <section className="panel panel-explain">
        <h2>What can happen now</h2>
        <p className="headline">{explanation.headline}</p>
        <ul>
          {explanation.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Your options</h2>

        {!wallet.connected && (
          <div className="actions">
            <p>Connect a wallet to take part.</p>
            <WalletMultiButton />
          </div>
        )}

        {wallet.connected && status === 'open' && privateCampaign && !invite && (
          <div className="actions locked">
            <p>
              <strong>🔒 This is a private campaign.</strong> Only people with the organizer’s invite
              link or QR code can contribute. Ask them to send it to you.
            </p>
            <div className="demo">
              <h3>Prove it to yourself</h3>
              <p>
                This page is not what keeps you out. Try contributing 0.01 USDC without the invite —
                the transaction really goes to the chain, and the program refuses it.
              </p>
              <button
                className="button button-danger"
                onClick={onInviteDemo}
                disabled={busy !== null || pending !== null}
              >
                {buttonLabel('demo-invite', 'Try to contribute without the invite (demo)')}
              </button>
            </div>
          </div>
        )}

        {wallet.connected && status === 'open' && (!privateCampaign || invite) && (
          <div className="actions">
            <div className="amount-row">
              <label>
                <span>Your name for the group</span>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={myContribution?.nickname || 'e.g. Kuba'}
                  maxLength={32}
                  disabled={pending !== null}
                />
              </label>
              <label>
                <span>Amount in USDC</span>
                <input
                  value={amountText}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  disabled={pending !== null}
                />
              </label>
              <button
                className="button button-primary"
                onClick={onContribute}
                disabled={busy !== null || pending !== null}
              >
                {buttonLabel('contribute', 'Contribute')}
              </button>
            </div>
            <p className="aside">
              {formatUsdc(remainingUnits)} is still needed. Contributions stop exactly at the goal.
            </p>
            {amountError && <p className="notice notice-error">{amountError}</p>}
            {myContribution && (
              <p className="aside">
                You have already put in {formatUsdc(myContribution.amount)}. Contributing again adds
                to that.
              </p>
            )}
          </div>
        )}

        {wallet.connected && status === 'succeeded' && (
          <div className="actions">
            <p>
              The goal was reached. Anyone can now send the money to the recipient — it can only
              ever go to them.
            </p>
            <button
              className="button button-primary"
              onClick={onWithdraw}
              disabled={busy !== null || pending !== null}
            >
              {buttonLabel('withdraw', isRecipient ? 'Send the money to me' : 'Send the money to the recipient')}
            </button>
          </div>
        )}

        {wallet.connected && refundsOpen(status) && (
          <div className="actions">
            {myContribution ? (
              <button
                className="button button-primary"
                onClick={onRefund}
                disabled={busy !== null || pending !== null}
              >
                {buttonLabel('refund', `Get my money back (${formatUsdc(myContribution.amount)})`)}
              </button>
            ) : (
              <p>You did not contribute to this campaign, so there is nothing for you to take back.</p>
            )}
          </div>
        )}

        {wallet.connected && status === 'withdrawn' && (
          <p>This campaign is settled. There is nothing left to do.</p>
        )}

        {reviewPanel}

        {wallet.connected && status === 'open' && isOrganizer && (
          <div className="actions">
            <h3>Organizer</h3>
            <p className="aside">
              You can call this campaign off until its goal is reached. That only opens refunds — it
              cannot move anyone&apos;s money.
            </p>
            <button
              className="button button-danger"
              onClick={onCancel}
              disabled={busy !== null || pending !== null}
            >
              {buttonLabel('cancel', 'Cancel campaign')}
            </button>
          </div>
        )}

        {/*
          The demo that makes the point. Anyone can trigger a payout -- but only
          once the goal is reached. Sent with preflight simulation turned off, so
          it genuinely lands on chain and is genuinely rejected by the program.
          This button is never disabled by a check in this file -- that is the
          whole idea.
        */}
        {wallet.connected && status === 'open' && (
          <div className="demo">
            <h3>Prove it to yourself</h3>
            <p>
              Anyone can send this campaign&apos;s money to the recipient — but only once the goal is
              reached. Try it now, before then. This really sends the transaction to the chain —
              this page will not stop you. The program will.
            </p>
            <button
              className="button button-danger"
              onClick={onDemo}
              disabled={busy !== null || pending !== null}
            >
              {buttonLabel('demo', 'Try to pay out early (demo)')}
            </button>
            <p className="aside">
              Costs a network fee and will fail. You will get a link to the failed transaction.
            </p>
          </div>
        )}

        {outcome && <TxResult outcome={outcome} onDismiss={() => setOutcome(null)} />}
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Leaderboard</h2>
            <p className="aside">Everyone who chipped in, largest first.</p>
          </div>
          <button className="link-button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {ranked.length === 0 ? (
          <p className="empty">Nobody yet.</p>
        ) : (
          <div className="leaderboard-scroll">
            <table className="table leaderboard">
              <thead>
                <tr>
                  <th className="right">#</th>
                  <th>Contributor</th>
                  <th className="right">Share</th>
                  <th className="right">Chipped in</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => {
                  const mine = !!me && row.contributor.equals(me)
                  return (
                    <tr key={row.contributor.toBase58()} className={mine ? 'leaderboard-me' : undefined}>
                      <td className="right leaderboard-rank">{row.rank}</td>
                      <td>
                        {row.nickname ? (
                          <>
                            <span className="nickname">{row.nickname}</span>
                            {mine && <span className="you"> you</span>}
                            <span className="address-under">
                              <Address address={row.contributor.toBase58()} explorer />
                            </span>
                          </>
                        ) : (
                          <Address address={row.contributor.toBase58()} you={mine} explorer />
                        )}
                      </td>
                      <td className="right">{sharePercent(row.total)}</td>
                      <td className="right">
                        <strong>{formatUsdc(row.total)}</strong>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {!privateCampaign && ranked.length > 0 && (
          <p className="aside">
            <Link to="/leaderboard">See who has chipped in the most across all public campaigns →</Link>
          </p>
        )}
        {campaign.totalRefunded.gt(new BN(0)) && (
          <p className="aside">
            {formatUsdc(campaign.totalRefunded)} has been taken back. A contributor disappears from
            this list once they take their money back.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Who is allowed to do what</h2>
        <table className="table table-permissions">
          <thead>
            <tr>
              <th>Action</th>
              <th>Who</th>
              <th>When</th>
              <th>Enforced by</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((row) => (
              <tr key={row.action}>
                <td>{row.action}</td>
                <td>{row.who}</td>
                <td>{row.when}</td>
                <td className="mono small">{row.enforcedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="aside">
          Held on chain at <Address address={campaignAddress} explorer />
        </p>
        <p className="notice notice-blocked">
          <strong>Don&apos;t send USDC straight to this address.</strong> Use Contribute above.
          Money sent directly lands in the campaign without a receipt: it does not count toward
          the goal, and if the goal is missed you cannot get it back.
        </p>
      </section>
    </article>
  )
}
