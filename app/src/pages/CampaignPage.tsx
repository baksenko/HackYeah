import { BN } from '@coral-xyz/anchor'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { Progress } from '../components/Progress'
import { SharePanel } from '../components/SharePanel'
import { StatusBadge } from '../components/StatusBadge'
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
import { CLUSTER_LABEL, explorerAddress } from '../lib/cluster'
import { PERMISSIONS, whatCanHappenNow } from '../lib/explain'
import { formatCountdown, formatDateTime, formatSol, shortKey, solToLamports } from '../lib/format'
import {
  inviteFromHash,
  recallInvite,
  recallNickname,
  rememberInvite,
  rememberNickname,
} from '../lib/invite'
import { contributionPda, useProgram } from '../lib/program'
import { sendTransaction, type TxOutcome } from '../lib/send'
import { useChainClock } from '../lib/useChainClock'

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

  /** Runs one action and refreshes from the chain afterwards. */
  async function run(
    key: string,
    build: () => Promise<Awaited<ReturnType<typeof buildContribute>>>,
    options: { skipPreflight?: boolean; extraSigners?: Keypair[] } = {},
  ) {
    if (!me || !wallet.signTransaction) return
    setOutcome(null)
    setBusy(key)
    try {
      const transaction = await build()
      const result = await sendTransaction(
        connection,
        { publicKey: me, signTransaction: wallet.signTransaction },
        transaction,
        options,
      )
      setOutcome(result)
      await load()
    } catch (error) {
      setOutcome({
        kind: 'never-sent',
        failure: {
          name: 'Unknown',
          message: String(error),
          plain: error instanceof Error ? error.message : 'Something went wrong.',
        },
      })
    } finally {
      setBusy(null)
    }
  }

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
    if (nickname.trim()) rememberNickname(nickname.trim())
    void run('contribute', () => buildContribute(lamports), {
      extraSigners: invite ? [invite] : [],
    })
  }

  return (
    <article className="campaign">
      <Link to="/" className="back">
        ← All campaigns
      </Link>

      <header className="campaign-head">
        <div>
          <h1>{campaign.title}</h1>
          <p className="campaign-sub">
            for {shortKey(campaign.recipient.toBase58())}
            {isRecipient && ' (you)'} · organised by {shortKey(campaign.organizer.toBase58())}
            {isOrganizer && ' (you)'}
          </p>
        </div>
        <div className="badges">
          <span className={`badge ${privateCampaign ? 'badge-private' : 'badge-public'}`}>
            {privateCampaign ? '🔒 Private' : '🌍 Public'}
          </span>
          <StatusBadge status={status} />
        </div>
      </header>

      <Progress campaign={campaign} />

      <p className="countdown">
        {status === 'open' ? (
          <>
            Closes in <strong>{formatCountdown(left)}</strong> — {formatDateTime(campaign.deadline.toNumber())}
          </>
        ) : (
          <>Closed on {formatDateTime(campaign.deadline.toNumber())}</>
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
                onClick={() =>
                  void run('demo-invite', () => buildContribute(solToLamports('0.01'), false), {
                    skipPreflight: true,
                  })
                }
                disabled={busy !== null}
              >
                {busy === 'demo-invite' ? 'Sending…' : 'Try to contribute without the invite (demo)'}
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
                />
              </label>
              <label>
                <span>Amount in SOL</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </label>
              <button
                className="button button-primary"
                onClick={onContribute}
                disabled={busy !== null}
              >
                {busy === 'contribute' ? 'Sending…' : 'Contribute'}
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
                onClick={() => void run('withdraw', buildWithdraw)}
                disabled={busy !== null}
              >
                {busy === 'withdraw' ? 'Sending…' : `Withdraw ${formatSol(campaign.totalRaised)}`}
              </button>
            ) : (
              <p>
                Waiting for {shortKey(campaign.recipient.toBase58())} to withdraw. Nobody else can
                do it for them.
              </p>
            )}
          </div>
        )}

        {wallet.connected && status === 'failed' && (
          <div className="actions">
            {myContribution ? (
              <button
                className="button button-primary"
                onClick={() => void run('refund', buildRefund)}
                disabled={busy !== null}
              >
                {busy === 'refund'
                  ? 'Sending…'
                  : `Get my money back (${formatSol(myContribution.amount)})`}
              </button>
            ) : (
              <p>You did not contribute to this campaign, so there is nothing for you to reclaim.</p>
            )}
          </div>
        )}

        {wallet.connected && status === 'withdrawn' && (
          <p>This campaign is settled. There is nothing left to do.</p>
        )}

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
              onClick={() => void run('demo', buildWithdraw, { skipPreflight: true })}
              disabled={busy !== null}
            >
              {busy === 'demo' ? 'Sending…' : 'Try to withdraw early (demo)'}
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
          <h2>Who chipped in</h2>
          <button className="link-button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {contributions.length === 0 ? (
          <p className="empty">Nobody yet.</p>
        ) : (
          <table className="table">
            <tbody>
              {contributions.map((c) => (
                <tr key={c.address.toBase58()}>
                  <td>
                    <a
                      href={explorerAddress(c.contributor.toBase58())}
                      target="_blank"
                      rel="noreferrer"
                      className={c.nickname ? 'nickname' : 'mono'}
                    >
                      {c.nickname || shortKey(c.contributor.toBase58())}
                    </a>
                    {!!me && c.contributor.equals(me) && <span className="you"> you</span>}
                    {c.nickname && (
                      <span className="address-under mono">{shortKey(c.contributor.toBase58())}</span>
                    )}
                  </td>
                  <td className="right">{formatSol(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          Held on chain at{' '}
          <a href={explorerAddress(campaign.address.toBase58())} target="_blank" rel="noreferrer" className="mono">
            {campaign.address.toBase58()}
          </a>
        </p>
      </section>
    </article>
  )
}
