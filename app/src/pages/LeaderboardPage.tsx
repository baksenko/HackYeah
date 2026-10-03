import { useWallet } from '@solana/wallet-adapter-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Contribution } from '../lib/campaign'
import { explorerAddress } from '../lib/cluster'
import { formatUsdc, shortKey } from '../lib/format'
import { useCampaignIndex } from '../lib/indexer'
import { buildLeaderboard, type LeaderboardRow } from '../lib/leaderboard'
import { useCampaignDirectory } from '../lib/useCampaignDirectory'

/** How many rows to list before only "your position" is shown below. */
const TOP = 50

/**
 * Who has chipped in the most to public campaigns. Built in the browser from
 * the contribution receipts on chain -- there is no leaderboard server.
 */
export function LeaderboardPage() {
  const index = useCampaignIndex()
  const { publicKey } = useWallet()
  const directory = useCampaignDirectory()

  const [contributions, setContributions] = useState<Contribution[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    index
      .allContributions()
      .then((list) => {
        if (!cancelled) {
          setContributions(list)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not read contributions from the chain.')
      })
    return () => {
      cancelled = true
    }
  }, [index, refreshKey])

  const rows = useMemo(() => {
    if (!contributions) return null
    const publicKeys = new Set(directory.publicCampaigns.map((c) => c.address.toBase58()))
    return buildLeaderboard(contributions, publicKeys)
  }, [contributions, directory.publicCampaigns])

  const mine = rows && publicKey ? rows.find((r) => r.contributor.equals(publicKey)) ?? null : null
  const loading = (rows === null || directory.loading) && !error && !directory.error

  function refresh() {
    setRefreshKey((k) => k + 1)
    void directory.reload()
  }

  return (
    <>
      <section className="page-head">
        <span className="eyebrow">Community</span>
        <h1>Leaderboard</h1>
        <p className="aside">
          Who has chipped in the most to public campaigns. Read straight from the chain: every
          number here can be checked on Solana Explorer.
        </p>
      </section>

      <section className="panel">
        <div className="section-head leaderboard-head">
          <h2>Top contributors</h2>
          <button className="link-button" onClick={refresh}>
            Refresh
          </button>
        </div>

        {(error || directory.error) && (
          <p className="notice notice-error">{error ?? directory.error}</p>
        )}

        {loading ? (
          <p className="empty">Reading the chain…</p>
        ) : rows && rows.length === 0 ? (
          <p className="empty-card">
            Nobody has contributed to a public campaign yet.{' '}
            <Link to="/campaigns?tab=public">Browse public campaigns</Link>
          </p>
        ) : (
          rows && (
            <div className="leaderboard-scroll">
              <table className="table leaderboard">
                <thead>
                  <tr>
                    <th className="right">#</th>
                    <th>Contributor</th>
                    <th className="right">Campaigns</th>
                    <th className="right">Chipped in</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, TOP).map((row) => (
                    <LeaderRow key={row.contributor.toBase58()} row={row} isMe={row === mine} />
                  ))}
                  {mine && mine.rank > TOP && (
                    <>
                      <tr className="leaderboard-gap" aria-hidden>
                        <td colSpan={4}>…</td>
                      </tr>
                      <LeaderRow row={mine} isMe />
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )
        )}

        {publicKey && rows && rows.length > 0 && !mine && (
          <p className="aside">
            You are not on the board yet: your wallet has no contributions to public campaigns.
          </p>
        )}
      </section>

      <section className="panel panel-explain">
        <h2>How this is counted</h2>
        <ul>
          <li>Only public campaigns count. Private friend-group campaigns are never shown here.</li>
          <li>
            A contribution counts while its receipt is on chain: in open campaigns and in ones that
            reached their goal. Taking a refund deletes the receipt, so refunded money drops off.
          </li>
          <li>
            Names are the nickname people chose when contributing, from their largest contribution.
            Without one, the wallet address is shown.
          </li>
        </ul>
      </section>
    </>
  )
}

function LeaderRow({ row, isMe }: { row: LeaderboardRow; isMe: boolean }) {
  const address = row.contributor.toBase58()
  return (
    <tr className={isMe ? 'leaderboard-me' : undefined}>
      <td className="right leaderboard-rank">{row.rank}</td>
      <td>
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noreferrer"
          className={row.nickname ? 'nickname' : 'mono'}
          title={address}
        >
          {row.nickname || shortKey(address)}
        </a>
        {isMe && <span className="you"> you</span>}
        {row.nickname && <span className="address-under mono">{shortKey(address)}</span>}
      </td>
      <td className="right">{row.campaigns}</td>
      <td className="right">
        <strong>{formatUsdc(row.total)}</strong>
      </td>
    </tr>
  )
}
