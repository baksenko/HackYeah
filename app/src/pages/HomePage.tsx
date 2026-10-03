import { useWallet } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Progress } from '../components/Progress'
import { StatusBadge } from '../components/StatusBadge'
import { campaignStatus, fetchCampaigns, secondsLeft, type Campaign } from '../lib/campaign'
import { formatCountdown, shortKey } from '../lib/format'
import { useProgram } from '../lib/program'
import { useChainClock } from '../lib/useChainClock'

export function HomePage() {
  const program = useProgram()
  const { connected } = useWallet()
  const now = useChainClock()

  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      setCampaigns(await fetchCampaigns(program))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read campaigns from the chain.')
    }
  }, [program])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <section className="hero">
        <h1>Chip in together, without a middleman</h1>
        <p>
          Pool money for a gift, a trip or a shared purchase. Everyone&apos;s money is held by a
          program on Solana — not by whoever organised it. If the goal is reached, only the person
          it was collected for can take it. If it is not, everybody takes back exactly what they
          put in.
        </p>
        <div className="hero-actions">
          {connected ? (
            <Link to="/new" className="button button-primary">
              Create a campaign
            </Link>
          ) : (
            <>
              <WalletMultiButton />
              <span className="aside">Connect a wallet to create a campaign or chip in.</span>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Campaigns</h2>
          <button className="link-button" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {error && <p className="notice notice-error">{error}</p>}
        {campaigns === null && !error && <p className="empty">Reading the chain…</p>}
        {campaigns?.length === 0 && (
          <p className="empty">
            No campaigns yet. {connected ? 'Create the first one.' : 'Connect a wallet to create one.'}
          </p>
        )}

        <ul className="card-list">
          {campaigns?.map((campaign) => {
            const status = campaignStatus(campaign, now)
            const left = secondsLeft(campaign, now)
            return (
              <li key={campaign.address.toBase58()}>
                <Link to={`/c/${campaign.address.toBase58()}`} className="card">
                  <div className="card-head">
                    <h3>{campaign.title}</h3>
                    <StatusBadge status={status} />
                  </div>
                  <Progress campaign={campaign} />
                  <p className="card-meta">
                    {status === 'open'
                      ? `Closes in ${formatCountdown(left)}`
                      : `Closed ${formatCountdown(-left)} ago`}
                    {' · for '}
                    {shortKey(campaign.recipient.toBase58())}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </>
  )
}
