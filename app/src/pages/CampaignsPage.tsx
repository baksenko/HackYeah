import { useWallet } from '@solana/wallet-adapter-react'
import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { CampaignCard } from '../components/CampaignCard'
import { campaignStatus, progressRatio, type Campaign } from '../lib/campaign'
import { decodeTags, tagBySlug, tagsForScope, type Tag } from '../lib/tags'
import { useCampaignDirectory } from '../lib/useCampaignDirectory'
import { useChainClock } from '../lib/useChainClock'

type Tab = 'all' | 'public' | 'private'
type StatusFilter = 'any' | 'open' | 'closed'
type Sort = 'ending' | 'newest' | 'funded'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'public', label: '🌍 Crowdfunding' },
  { id: 'private', label: '🔒 Your friend groups' },
]

/**
 * Search and browse. Every filter lives in the URL, so a search can be
 * bookmarked or sent to someone as a link. Filtering happens in the browser
 * over what `getProgramAccounts` returned — there is no search server.
 */
export function CampaignsPage() {
  const { connected } = useWallet()
  const now = useChainClock()
  const { loading, error, reload, publicCampaigns, myPrivate } = useCampaignDirectory()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') ?? ''
  const tab = (params.get('tab') as Tab) || 'all'
  const status = (params.get('status') as StatusFilter) || 'any'
  const sort = (params.get('sort') as Sort) || 'ending'
  const selected = useMemo(
    () => (params.get('tags') ?? '').split(',').map(tagBySlug).filter((t): t is Tag => !!t),
    [params],
  )

  /** Updates one URL parameter, dropping it when it is back to its default. */
  const set = (key: string, value: string, fallback = '') => {
    const next = new URLSearchParams(params)
    if (value && value !== fallback) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  const toggleTag = (tag: Tag) => {
    const slugs = new Set(selected.map((t) => t.slug))
    if (slugs.has(tag.slug)) slugs.delete(tag.slug)
    else slugs.add(tag.slug)
    set('tags', [...slugs].join(','))
  }

  const chipScopes =
    tab === 'public' ? (['public'] as const) : tab === 'private' ? (['private'] as const) : (['public', 'private'] as const)

  const results = useMemo(() => {
    const pool: Campaign[] =
      tab === 'public' ? publicCampaigns : tab === 'private' ? myPrivate : [...myPrivate, ...publicCampaigns]

    // Every word must match the title or one of the tag names.
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const selectedMask = selected.reduce((m, t) => (m | (1 << t.bit)) >>> 0, 0)

    const filtered = pool.filter((c) => {
      if (selectedMask && !((c.tags & selectedMask) >>> 0)) return false
      const s = campaignStatus(c, now)
      if (status === 'open' && s !== 'open') return false
      if (status === 'closed' && s === 'open') return false
      if (!words.length) return true
      const haystack = [c.title, ...decodeTags(c.tags).map((t) => t.label)].join(' ').toLowerCase()
      return words.every((w) => haystack.includes(w))
    })

    const byDeadline = (a: Campaign, b: Campaign) => {
      // Open campaigns first, soonest deadline first; then closed, most recent first.
      const aOpen = a.deadline.toNumber() > now
      const bOpen = b.deadline.toNumber() > now
      if (aOpen !== bOpen) return aOpen ? -1 : 1
      return aOpen ? a.deadline.cmp(b.deadline) : b.deadline.cmp(a.deadline)
    }
    const sorters: Record<Sort, (a: Campaign, b: Campaign) => number> = {
      ending: byDeadline,
      newest: (a, b) => b.campaignId.cmp(a.campaignId),
      funded: (a, b) => progressRatio(b) - progressRatio(a),
    }
    return filtered.sort(sorters[sort])
  }, [tab, publicCampaigns, myPrivate, q, selected, status, sort, now])

  const hasFilters = q || selected.length || status !== 'any' || tab !== 'all'

  return (
    <>
      <section className="page-head">
        <span className="eyebrow">Browse</span>
        <h1>Campaigns</h1>
        <p className="aside">
          Public crowdfunding is open to everyone. Private friend-group campaigns appear here only
          for people already in them.
        </p>
      </section>

      <section className="search panel">
        <div className="search-box">
          <span aria-hidden>🔍</span>
          <input
            type="search"
            value={q}
            onChange={(e) => set('q', e.target.value)}
            placeholder="Search by name or tag — e.g. “trip”, “animals”, “Zielona”"
            aria-label="Search campaigns"
          />
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'tab-active' : ''}`}
              onClick={() => set('tab', t.id, 'all')}
            >
              {t.label}
              <span className="tab-count">
                {t.id === 'public'
                  ? publicCampaigns.length
                  : t.id === 'private'
                    ? myPrivate.length
                    : publicCampaigns.length + myPrivate.length}
              </span>
            </button>
          ))}
        </div>

        {chipScopes.map((scope) => (
          <div key={scope} className="chip-row">
            {chipScopes.length > 1 && (
              <span className="chip-row-label">{scope === 'public' ? 'Causes' : 'Friends'}</span>
            )}
            {tagsForScope(scope).map((tag) => {
              const on = selected.some((t) => t.slug === tag.slug)
              return (
                <button
                  key={tag.slug}
                  className={`chip ${on ? 'chip-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleTag(tag)}
                >
                  {tag.emoji} {tag.label}
                </button>
              )
            })}
          </div>
        ))}

        <div className="search-foot">
          <label className="inline-select">
            <span>Status</span>
            <select value={status} onChange={(e) => set('status', e.target.value, 'any')}>
              <option value="any">Any</option>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="inline-select">
            <span>Sort</span>
            <select value={sort} onChange={(e) => set('sort', e.target.value, 'ending')}>
              <option value="ending">Ending soon</option>
              <option value="newest">Newest</option>
              <option value="funded">Most funded</option>
            </select>
          </label>
          {hasFilters && (
            <button className="link-button" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          )}
          <button className="link-button push-right" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </section>

      {error && <p className="notice notice-error">{error}</p>}

      {tab === 'private' && !connected && (
        <p className="empty-card">
          Connect your wallet to see your private campaigns. Got an invite link or QR code? Just open
          it.
        </p>
      )}

      {loading ? (
        <p className="empty">Reading the chain…</p>
      ) : (
        <>
          <p className="result-count">
            {results.length} campaign{results.length === 1 ? '' : 's'}
            {selected.length > 0 && ` tagged ${selected.map((t) => t.label).join(' or ')}`}
            {q && ` matching “${q}”`}
          </p>
          {results.length === 0 ? (
            <p className="empty-card">
              Nothing matches.{' '}
              {hasFilters ? (
                <button className="link-button" onClick={() => setParams({}, { replace: true })}>
                  Clear the filters
                </button>
              ) : (
                <Link to="/new">Start the first campaign</Link>
              )}
            </p>
          ) : (
            <ul className="card-list">
              {results.map((c) => (
                <li key={c.address.toBase58()}>
                  <CampaignCard campaign={c} now={now} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

    </>
  )
}
