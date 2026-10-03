import { BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey, SystemProgram, type Transaction } from '@solana/web3.js'
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
  fetchCampaign,
  fetchContributions,
  secondsLeft,
  type Campaign,
  type Contribution,
} from '../lib/campaign'
import { CLUSTER_LABEL } from '../lib/cluster'
import { PERMISSIONS, whatCanHappenNow } from '../lib/explain'
import { CONTRIBUTION_ACCOUNT_SPACE, accountDeposit, networkFee } from '../lib/fees'
import { formatCountdown, formatDateTime, formatSol, shortKey, solToLamports } from '../lib/format'
import { buildLeaderboard } from '../lib/leaderboard'
import {
  inviteFromHash,
  recallInvite,
  recallNickname,
  rememberInvite,
  rememberNickname,
} from '../lib/invite'
import { contributionPda, useProgram } from '../lib/program'
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
  const { connection } = useConnection()
  const wallet = useWallet()
  const now = useChainClock()

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<TxOutcome | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [amount, setAmount] = useState('0.1')
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
      const [next, contribs] = await Promise.all([
        fetchCampaign(program, campaignKey),
        fetchContributions(program, campaignKey),
      ])
      setCampaign(next)
      setContributions(contribs)
    } catch {
      setLoadError(`No campaign exists at this address on the ${CLUSTER_LABEL}.`)
    }
  }, [program, campaignKey])

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
    describe: (fee: number) => Promise<ReviewView>,
    options: SendOptions = {},
  ) {
    if (!me) return
    setOutcome(null)
    setBusy(key)
    try {
      const transaction = await build()
      const fee = await networkFee(connection, transaction, me)
      setPending({ key, transaction, options, view: await describe(fee) })
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
  const recipientAddress = campaign.recipient.toBase58()
  const deadline = campaign.deadline.toNumber()
  const totalRaised = Number(campaign.totalRaised.toString())

  // This campaign's own leaderboard: the same ranking as the global one,
  // counting only this campaign's receipts. Refunded receipts are gone already.
  const ranked = buildLeaderboard(contributions, new Set([campaignAddress]))
  const stillHeld = ranked.reduce((sum, r) => sum.add(r.total), new BN(0))
  const sharePercent = (amount: BN) =>
    stillHeld.isZero() ? '—' : `${Math.round((Number(amount.toString()) / Number(stillHeld.toString())) * 100)}%`

  /**
   * `withInvite: false` deliberately leaves the invite out even when this
   * browser has one — that is how the demo proves the program checks it.
   */
  const buildContribute = async (lamports: BN, withInvite = true) =>
    program.methods
      .contribute(lamports, nickname.trim())
      .accountsPartial({
        contributor: me!,
        campaign: campaign.address,
        contribution: contributionPda(campaign.address, me!),
        invite: withInvite && invite ? invite.publicKey : null,
        systemProgram: SystemProgram.programId,
      })
      .transaction()

  const buildWithdraw = async () =>
    program.methods
      .withdraw()
      .accountsPartial({ recipient: me!, campaign: campaign.address })
      .transaction()

  const buildRefund = async () =>
    program.methods
      .refund()
      .accountsPartial({
        contributor: me!,
        campaign: campaign.address,
        contribution: contributionPda(campaign.address, me!),
      })
      .transaction()

  function onContribute() {
    setAmountError(null)
    let lamports: BN
    try {
      lamports = solToLamports(amount)
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : 'Enter a valid amount.')
      return
    }
    const name = nickname.trim()
    if (name) rememberNickname(name)
    void review(
      'contribute',
      () => buildContribute(lamports),
      async (fee) => {
        // The receipt account is created on a first contribution only.
        const deposit = myContribution
          ? 0
          : await accountDeposit(connection, CONTRIBUTION_ACCOUNT_SPACE)
        return {
          heading: 'Review your contribution',
          parties: [
            { label: 'Locked in this campaign account', address: campaignAddress },
            { label: 'Paid out to this recipient if the goal is reached', address: recipientAddress },
          ],
          lines: [
            { label: 'Your contribution', lamports: Number(lamports.toString()), direction: 'out' },
            ...(deposit
              ? [
                  {
                    label: 'One-time receipt deposit',
                    lamports: deposit,
                    direction: 'out' as const,
                    note: 'Returned with your refund if the goal is missed. If the goal is reached it stays locked on chain for good.',
                  },
                ]
              : []),
            { label: 'Network fee', lamports: fee, direction: 'out' },
          ],
          facts: [
            'You cannot take this back while the campaign is open, even if you change your mind.',
            `If the goal is missed by ${formatDateTime(deadline)}, you can reclaim exactly this amount.`,
            'If the goal is reached, it goes to the recipient above and cannot be refunded.',
            name
              ? `The group will see you as “${name}”. Your wallet address is public either way.`
              : 'The group will see your wallet address.',
          ],
          confirmLabel: `Confirm and contribute ${formatSol(lamports)}`,
        }
      },
      { extraSigners: invite ? [invite] : [] },
    )
  }

  function onWithdraw() {
    void review('withdraw', buildWithdraw, async (fee) => ({
      heading: 'Review your withdrawal',
      parties: [
        { label: 'Paid from this campaign account', address: campaignAddress },
        { label: 'To your wallet', address: me!.toBase58() },
      ],
      lines: [
        { label: 'Payout', lamports: totalRaised, direction: 'in' },
        { label: 'Network fee', lamports: fee, direction: 'out' },
      ],
      facts: [
        'This is final. The program records the withdrawal and refuses a second one.',
        'Once it reaches your wallet, nobody can reverse it.',
      ],
      confirmLabel: 'Confirm and withdraw',
    }))
  }

  function onRefund() {
    if (!myContribution) return
    void review('refund', buildRefund, async (fee) => {
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
          { label: 'Your contribution back', lamports: Number(myContribution.amount.toString()), direction: 'in' },
          { label: 'Receipt deposit returned', lamports: receipt, direction: 'in' },
          { label: 'Network fee', lamports: fee, direction: 'out' },
        ],
        facts: ['Your receipt is deleted as it pays out, so a refund can only happen once.'],
        confirmLabel: `Confirm and get ${formatSol(myContribution.amount)} back`,
      }
    })
  }

  function onDemo() {
    void review(
      'demo',
      buildWithdraw,
      async (fee) => ({
        heading: 'Review: early withdrawal attempt (demo)',
        parties: [{ label: 'Trying to withdraw from this campaign account', address: campaignAddress }],
        lines: [
          {
            label: 'Network fee',
            lamports: fee,
            direction: 'out',
            note: 'Charged even though the program will reject the transaction.',
          },
        ],
        facts: [
          'The program will refuse this. No money moves except the fee.',
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
      () => buildContribute(solToLamports('0.01'), false),
      async (fee) => ({
        heading: 'Review: contributing without the invite (demo)',
        parties: [{ label: 'Trying to contribute to this campaign account', address: campaignAddress }],
        lines: [
          {
            label: 'Network fee',
            lamports: fee,
            direction: 'out',
            note: 'Charged even though the program will reject the transaction.',
          },
        ],
        facts: [
          'The program will refuse this because the invite key did not sign. The 0.01 SOL never leaves your wallet.',
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
        {status === 'open' ? (
          <>
            Closes in <strong>{formatCountdown(left)}</strong> — {formatDateTime(deadline)}
          </>
        ) : (
          <>Closed on {formatDateTime(deadline)}</>
        )}
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
                This page is not what keeps you out. Try contributing 0.01 SOL without the invite —
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
                <span>Amount in SOL</span>
                <input
                  value={amount}
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
            {amountError && <p className="notice notice-error">{amountError}</p>}
            {myContribution && (
              <p className="aside">
                You have already put in {formatSol(myContribution.amount)}. Contributing again adds
                to that.
              </p>
            )}
          </div>
        )}

        {wallet.connected && status === 'succeeded' && (
          <div className="actions">
            {isRecipient ? (
              <button
                className="button button-primary"
                onClick={onWithdraw}
                disabled={busy !== null || pending !== null}
              >
                {buttonLabel('withdraw', `Withdraw ${formatSol(campaign.totalRaised)}`)}
              </button>
            ) : (
              <p>
                Waiting for {shortKey(recipientAddress)} to withdraw. Nobody else can do it for
                them.
              </p>
            )}
          </div>
        )}

        {wallet.connected && status === 'failed' && (
          <div className="actions">
            {myContribution ? (
              <button
                className="button button-primary"
                onClick={onRefund}
                disabled={busy !== null || pending !== null}
              >
                {buttonLabel('refund', `Get my money back (${formatSol(myContribution.amount)})`)}
              </button>
            ) : (
              <p>You did not contribute to this campaign, so there is nothing for you to reclaim.</p>
            )}
          </div>
        )}

        {wallet.connected && status === 'withdrawn' && (
          <p>This campaign is settled. There is nothing left to do.</p>
        )}

        {reviewPanel}

        {/*
          The demo that makes the point. On an open campaign the organizer and
          the recipient are offered the withdrawal they are not yet entitled to.
          It is sent with preflight simulation turned off, so it genuinely
          lands on devnet and is genuinely rejected by the program. This button
          is never disabled by a check in this file -- that is the whole idea.
        */}
        {wallet.connected && status === 'open' && (isOrganizer || isRecipient) && (
          <div className="demo">
            <h3>Prove it to yourself</h3>
            <p>
              You organised this campaign, or the money is meant for you. Try taking it out right
              now, before the deadline. This really sends the transaction to the chain — this page
              will not stop you. The program will.
            </p>
            <button
              className="button button-danger"
              onClick={onDemo}
              disabled={busy !== null || pending !== null}
            >
              {buttonLabel('demo', 'Try to withdraw early (demo)')}
            </button>
            <p className="aside">
              Costs a devnet transaction fee and will fail. You will get a link to the failed
              transaction.
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
                        <strong>{formatSol(row.total)}</strong>
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
            {formatSol(campaign.totalRefunded)} has been reclaimed. A contributor disappears from
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
      </section>
    </article>
  )
}
