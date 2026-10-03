import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Progress } from '../components/Progress'
import { StatusBadge } from '../components/StatusBadge'
import {
  campaignStatus,
  fetchCampaigns,
  fetchMyCampaignKeys,
  isPrivate,
  secondsLeft,
  type Campaign,
} from '../lib/campaign'
import { formatCountdown, shortKey } from '../lib/format'
import { recallInvite } from '../lib/invite'
import { useProgram } from '../lib/program'
import { useChainClock } from '../lib/useChainClock'

export function HomePage() {
  const program = useProgram()
  const { connected, publicKey } = useWallet()
  const now = useChainClock()

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [joined, setJoined] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const [all, mine] = await Promise.all([
        fetchCampaigns(program),
        publicKey ? fetchMyCampaignKeys(program, publicKey) : Promise.resolve(new Set<string>()),
      ])
      setCampaigns(all)
      setJoined(mine)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read campaigns from the chain.')
    }
  }, [program, publicKey])

  useEffect(() => {
    void load()
  }, [load])

  const publicCampaigns = campaigns?.filter((c) => !isPrivate(c)) ?? []

  // A private campaign appears here only for people already part of it:
  // the organizer, the recipient, a contributor, or someone whose browser
  // holds the invite. Everyone else needs the link.
  const myPrivate =
    campaigns?.filter(
      (c) =>
        isPrivate(c) &&
        ((publicKey && (c.organizer.equals(publicKey) || c.recipient.equals(publicKey))) ||
          joined.has(c.address.toBase58()) ||
          !!recallInvite(c.address)?.publicKey.equals(c.invite!)),
    ) ?? []

  const renderCard = (campaign: Campaign) => {
    const status = campaignStatus(campaign, now)
    const left = secondsLeft(campaign, now)
    const priv = isPrivate(campaign)
    return (
      <li key={campaign.address.toBase58()}>
        <Link to={`/c/${campaign.address.toBase58()}`} className="card">
          <div className={`card-banner ${priv ? 'banner-private' : 'banner-public'}`}>
            <span className="card-kind">{priv ? '🔒 Friends' : '🌍 Crowdfunding'}</span>
            <StatusBadge status={status} />
          </div>
          <div className="card-body">
            <h3>{campaign.title}</h3>
            <Progress campaign={campaign} />
            <p className="card-meta">
              {status === 'open'
                ? `Closes in ${formatCountdown(left)}`
                : `Closed ${formatCountdown(-left)} ago`}
              {' · for '}
              {shortKey(campaign.recipient.toBase58())}
            </p>
          </div>
        </Link>
      </li>
    )
  }

  return (
    <>
      <section className="hero">
        <span className="eyebrow">No middleman · held by a Solana program</span>
        <h1>
          Chip in together, <span className="gradient-text">without trusting anyone</span>
        </h1>
        <p>
          Pool money with friends for a trip or a gift, or raise it publicly for a cause. The money
          is held by a program on Solana — not by whoever organised it. Goal reached: only the
          recipient can take it. Goal missed: everybody gets back exactly what they put in.
        </p>
        <div className="hero-actions">
          {connected ? (
            <Link to="/new" className="button button-primary button-large">
              Start a campaign
            </Link>
          ) : (
            <>
              <WalletMultiButton />
              <span className="aside">Connect a wallet to start a campaign or chip in.</span>
            </>
          )}
        </div>
        <div className="hero-pills">
          <span className="pill">🔒 Private invite links</span>
          <span className="pill">📱 QR sharing</span>
          <span className="pill">↩︎ Automatic refunds</span>
          <span className="pill">🔍 Every rule on chain</span>
        </div>
      </section>

      {error && <p className="notice notice-error">{error}</p>}

      <section className="list-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">🔒 Private</span>
            <h2>Your friend groups</h2>
            <p className="aside">
              Private campaigns are not listed for anyone else. You see the ones you organise,
              receive, or have joined.
            </p>
          </div>
        </div>
        {!connected ? (
          <p className="empty-card">
            Connect your wallet to see your private campaigns. Got an invite link or QR code? Just
            open it.
          </p>
        ) : campaigns === null ? (
          <p className="empty">Reading the chain…</p>
        ) : myPrivate.length === 0 ? (
          <p className="empty-card">
            No private campaigns yet. <Link to="/new">Start one for your friends</Link>, or open an
            invite link someone sent you.
          </p>
        ) : (
          <ul className="card-list">{myPrivate.map(renderCard)}</ul>
        )}
      </section>

      <section className="list-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">🌍 Public</span>
            <h2>Crowdfunding</h2>
            <p className="aside">Open to everyone. Anyone can see these and chip in.</p>
          </div>
          <button className="link-button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {campaigns === null && !error && <p className="empty">Reading the chain…</p>}
        {campaigns !== null && publicCampaigns.length === 0 && (
          <p className="empty-card">No public campaigns yet.</p>
        )}
        <ul className="card-list">{publicCampaigns.map(renderCard)}</ul>
      </section>
    </>
  )
}
