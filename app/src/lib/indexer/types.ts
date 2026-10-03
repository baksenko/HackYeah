import type { PublicKey } from '@solana/web3.js'

import type { Campaign, Contribution } from '../campaign'

/**
 * Where the app reads campaigns and contributions from. Balances and status
 * always come from these on-chain accounts; an index only decides how they
 * are found.
 *
 * Today the only implementation is `RpcCampaignIndex` (plain RPC
 * getProgramAccounts with memcmp filters). An indexing service such as Helius
 * can be added later as another implementation of this interface, without
 * touching the pages.
 */
export interface CampaignIndex {
  /** Every campaign of this program. */
  campaigns(): Promise<Campaign[]>
  /** One campaign, or null if no campaign exists at that address. */
  campaign(address: PublicKey): Promise<Campaign | null>
  /** Every receipt (contribution) in one campaign. */
  contributionsTo(campaign: PublicKey): Promise<Contribution[]>
  /** Addresses of the campaigns a wallet has a receipt in. */
  campaignsContributedBy(wallet: PublicKey): Promise<Set<string>>
  /** Every receipt in every campaign. */
  allContributions(): Promise<Contribution[]>
}
