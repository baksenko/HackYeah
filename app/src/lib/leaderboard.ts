import { BN } from '@coral-xyz/anchor'
import type { PublicKey } from '@solana/web3.js'

import type { Contribution } from './campaign'
import type { FundraiserProgram } from './program'

export type LeaderboardRow = {
  contributor: PublicKey
  /** Nickname from this contributor's largest counted contribution; may be empty. */
  nickname: string
  total: BN
  campaigns: number
  /** Standard competition rank: equal totals share a rank (1, 2, 2, 4). */
  rank: number
}

/** Every contribution receipt on chain, across all campaigns. */
export async function fetchAllContributions(program: FundraiserProgram): Promise<Contribution[]> {
  const accounts = await program.account.contribution.all()
  return accounts.map((a) => ({ address: a.publicKey, ...(a.account as Omit<Contribution, 'address'>) }))
}

/**
 * Totals per contributor, counting only receipts that belong to one of
 * `countedCampaigns` -- the public ones. Private friend-group campaigns are
 * left out so the leaderboard never reveals who gave what to them.
 *
 * Refunds close their receipt, so refunded money drops out on its own; what
 * remains is money still pledged to open campaigns or paid to successful ones.
 */
export function buildLeaderboard(
  contributions: Contribution[],
  countedCampaigns: Set<string>,
): LeaderboardRow[] {
  const byContributor = new Map<string, { contributor: PublicKey; total: BN; campaigns: number; best: Contribution }>()

  for (const c of contributions) {
    if (!countedCampaigns.has(c.campaign.toBase58())) continue
    const key = c.contributor.toBase58()
    const entry = byContributor.get(key)
    if (!entry) {
      byContributor.set(key, { contributor: c.contributor, total: c.amount, campaigns: 1, best: c })
      continue
    }
    entry.total = entry.total.add(c.amount)
    entry.campaigns += 1
    // Prefer a named contribution, then the larger one, for the display name.
    if ((!entry.best.nickname && c.nickname) || (!!c.nickname === !!entry.best.nickname && c.amount.gt(entry.best.amount))) {
      entry.best = c
    }
  }

  const sorted = [...byContributor.values()].sort(
    (a, b) =>
      b.total.cmp(a.total) ||
      b.campaigns - a.campaigns ||
      a.contributor.toBase58().localeCompare(b.contributor.toBase58()),
  )

  let rank = 0
  return sorted.map((entry, index) => {
    if (index === 0 || !entry.total.eq(sorted[index - 1].total)) rank = index + 1
    return {
      contributor: entry.contributor,
      nickname: entry.best.nickname,
      total: entry.total,
      campaigns: entry.campaigns,
      rank,
    }
  })
}
