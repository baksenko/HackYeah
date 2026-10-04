import { BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

/** The program's stored status (`CampaignStatus` in state.rs), as Anchor decodes it. */
export type OnChainStatus = { active: object } | { succeeded: object } | { withdrawn: object } | { cancelled: object }

export type Campaign = {
  address: PublicKey
  organizer: PublicKey
  recipient: PublicKey
  /** Always the program's USDC_MINT. */
  mint: PublicKey
  campaignId: BN
  status: OnChainStatus
  title: string
  /** In USDC base units (6 decimals). */
  goal: BN
  deadline: BN
  totalRaised: BN
  totalRefunded: BN
  /** Set for private campaigns: contributing needs this key's signature. */
  invite: PublicKey | null
  /** Bitmask; decode with `decodeTags` from ./tags. */
  tags: number
  /** The organizer's own words; may be empty. */
  description: string
  /** An `https://` link to a photo hosted elsewhere, or empty. */
  imageUrl: string
  /** Solana Pay: the shop's payment reference; every payout must carry it. */
  reference: PublicKey | null
  /** Solana Pay: the shop's memo, added to the payout; empty when none. */
  memo: string
  bump: number
}

export type Contribution = {
  address: PublicKey
  campaign: PublicKey
  contributor: PublicKey
  /** In USDC base units. */
  amount: BN
  /** Chosen by the contributor; empty means "show my address". */
  nickname: string
  bump: number
}

export const isPrivate = (campaign: Campaign) => campaign.invite !== null

/**
 * What a person needs to know about a campaign right now:
 * - open: taking contributions;
 * - succeeded: goal reached, waiting for someone to send the money to the recipient;
 * - failed: deadline passed without reaching the goal, refunds open;
 * - cancelled: called off by the organizer, refunds open;
 * - withdrawn: paid out to the recipient.
 */
export type CampaignStatus = 'open' | 'succeeded' | 'failed' | 'cancelled' | 'withdrawn'

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  open: 'Open',
  succeeded: 'Goal reached',
  failed: 'Goal missed',
  cancelled: 'Cancelled',
  withdrawn: 'Paid out',
}

/**
 * Read from the program's stored status, plus the clock for one case the
 * program also decides by the clock: an Active campaign past its deadline has
 * failed. The UI never decides anything else.
 */
export function campaignStatus(campaign: Campaign, nowSeconds: number): CampaignStatus {
  const stored = Object.keys(campaign.status)[0]
  if (stored === 'withdrawn') return 'withdrawn'
  if (stored === 'cancelled') return 'cancelled'
  if (stored === 'succeeded') return 'succeeded'
  return nowSeconds < campaign.deadline.toNumber() ? 'open' : 'failed'
}

/** Refunds are open when the goal was missed or the campaign was cancelled. */
export const refundsOpen = (status: CampaignStatus) => status === 'failed' || status === 'cancelled'

export const progressRatio = (campaign: Campaign): number => {
  const goal = Number(campaign.goal.toString())
  if (goal <= 0) return 0
  return Number(campaign.totalRaised.toString()) / goal
}

export const secondsLeft = (campaign: Campaign, nowSeconds: number): number =>
  campaign.deadline.toNumber() - nowSeconds
