import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { Link } from 'react-router-dom'

import { CampaignCard } from '../components/CampaignCard'
import { campaignStatus, progressRatio } from '../lib/campaign'
import { tagsForScope } from '../lib/tags'
import { useCampaignDirectory } from '../lib/useCampaignDirectory'
import { useChainClock } from '../lib/useChainClock'

const STEPS = [
  {
    icon: '📝',
    title: 'Set the rules once',
    text: 'Goal, deadline and who receives the money. Written into a Solana program — nobody can change them afterwards, not even you.',
  },
  {
    icon: '📱',
    title: 'Share a link or QR code',
    text: 'Friends scan it and chip in. Private campaigns accept money only from people holding your invite.',
  },
  {
    icon: '⚖️',
    title: 'The program settles it',
    text: 'Goal reached: only the recipient can take the money. Goal missed: everyone takes back exactly what they put in.',
  },
]

/** Landing page. The full, searchable list lives on /campaigns. */
export function HomePage() {
  const { connected } = useWallet()
  const now = useChainClock()
  const { loading, publicCampaigns, myPrivate } = useCampaignDirectory()

  const openFirst = (list: typeof publicCampaigns) =>
    [...list]
      .filter((c) => campaignStatus(c, now) === 'open')
      .sort((a, b) => progressRatio(b) - progressRatio(a))
      .slice(0, 3)

  const featured = openFirst(publicCampaigns)
  const mineOpen = openFirst(myPrivate)

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
            <WalletMultiButton />
          )}
          <Link to="/campaigns" className="button button-secondary button-large">
            Browse campaigns →
          </Link>
        </div>
      </section>

      <section className="steps">
        {STEPS.map((step, i) => (
          <div key={step.title} className="step">
            <span className="step-icon">{step.icon}</span>
            <span className="step-number">Step {i + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        ))}
      </section>

      <section className="list-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">Browse by tag</span>
            <h2>What are people raising for?</h2>
          </div>
        </div>
        <div className="tag-cloud">
          {[...tagsForScope('public'), ...tagsForScope('private')].map((tag) => (
            <Link key={tag.slug} to={`/campaigns?tags=${tag.slug}`} className={`tag-tile tag-${tag.scope}`}>
              <span className="tag-tile-emoji">{tag.emoji}</span>
              {tag.label}
            </Link>
          ))}
        </div>
      </section>

      {mineOpen.length > 0 && (
        <section className="list-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">🔒 Private</span>
              <h2>Your friend groups</h2>
            </div>
            <Link to="/campaigns?tab=private" className="link-button">
              See all →
            </Link>
          </div>
          <ul className="card-list">
            {mineOpen.map((c) => (
              <li key={c.address.toBase58()}>
                <CampaignCard campaign={c} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="list-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">🌍 Crowdfunding</span>
            <h2>Open right now</h2>
          </div>
          <Link to="/campaigns?tab=public&status=open" className="link-button">
            See all →
          </Link>
        </div>
        {loading ? (
          <p className="empty">Reading the chain…</p>
        ) : featured.length === 0 ? (
          <p className="empty-card">
            No public campaigns are open right now. <Link to="/campaigns">Browse all campaigns</Link>
          </p>
        ) : (
          <ul className="card-list">
            {featured.map((c) => (
              <li key={c.address.toBase58()}>
                <CampaignCard campaign={c} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
