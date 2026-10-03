import { BN } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'

import type { FundraiserProgram } from './program'

export type Campaign = {
  address: PublicKey
  organizer: PublicKey
  recipient: PublicKey
  campaignId: BN
  title: string
  goal: BN
  deadline: BN
  totalRaised: BN
  totalRefunded: BN
  withdrawn: boolean
  /** Set for private campaigns: contributing needs this key's signature. */
  invite: PublicKey | null
  /** Bitmask; decode with `decodeTags` from ./tags. */
  tags: number
  /** The organizer's own words; may be empty. */
  description: string
  /** An `https://` link to a photo hosted elsewhere, or empty. */
  imageUrl: string
  bump: number
}

export type Contribution = {
  address: PublicKey
  campaign: PublicKey
  contributor: PublicKey
  amount: BN
  /** Chosen by the contributor; empty means "show my address". */
  nickname: string
  bump: number
}

export const isPrivate = (campaign: Campaign) => campaign.invite !== null

export type CampaignStatus = 'open' | 'succeeded' | 'failed' | 'withdrawn'

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  open: 'Open',
  succeeded: 'Succeeded',
  failed: 'Failed',
  withdrawn: 'Withdrawn',
}

/**
 * Derived purely from on-chain fields plus the clock. The UI never decides
 * this -- it only reads what the program already recorded.
 */
export function campaignStatus(campaign: Campaign, nowSeconds: number): CampaignStatus {
  if (campaign.withdrawn) return 'withdrawn'
  if (nowSeconds < campaign.deadline.toNumber()) return 'open'
  return campaign.totalRaised.gte(campaign.goal) ? 'succeeded' : 'failed'
}

export const progressRatio = (campaign: Campaign): number => {
  const goal = Number(campaign.goal.toString())
  if (goal <= 0) return 0
  return Number(campaign.totalRaised.toString()) / goal
}

export const secondsLeft = (campaign: Campaign, nowSeconds: number): number =>
  campaign.deadline.toNumber() - nowSeconds

export async function fetchCampaigns(program: FundraiserProgram): Promise<Campaign[]> {
  // `.all()` is getProgramAccounts filtered by the Campaign discriminator.
  const accounts = await program.account.campaign.all()
  return accounts
    .map((a) => ({ address: a.publicKey, ...(a.account as Omit<Campaign, 'address'>) }))
    .sort((a, b) => b.deadline.cmp(a.deadline))
}

export async function fetchCampaign(
  program: FundraiserProgram,
  address: PublicKey,
): Promise<Campaign> {
  const account = await program.account.campaign.fetch(address)
  return { address, ...(account as Omit<Campaign, 'address'>) }
}

export async function fetchContributions(
  program: FundraiserProgram,
  campaign: PublicKey,
): Promise<Contribution[]> {
  // `campaign` is the first field after the discriminator, so one memcmp at
  // offset 8 finds every contributor of this campaign.
  const accounts = await program.account.contribution.all([
    { memcmp: { offset: 8, bytes: campaign.toBase58() } },
  ])
  return accounts
    .map((a) => ({ address: a.publicKey, ...(a.account as Omit<Contribution, 'address'>) }))
    .sort((a, b) => b.amount.cmp(a.amount))
}

/**
 * Every campaign this wallet has contributed to. `contributor` sits right
 * after `campaign` (8-byte discriminator + 32-byte pubkey = offset 40).
 */
export async function fetchMyCampaignKeys(
  program: FundraiserProgram,
  wallet: PublicKey,
): Promise<Set<string>> {
  const accounts = await program.account.contribution.all([
    { memcmp: { offset: 40, bytes: wallet.toBase58() } },
  ])
  return new Set(accounts.map((a) => (a.account.campaign as PublicKey).toBase58()))
}
