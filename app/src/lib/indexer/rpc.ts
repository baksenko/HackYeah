import type { PublicKey } from '@solana/web3.js'

import type { Campaign, Contribution } from '../campaign'
import { USDC_MINT, type FundraiserProgram } from '../program'
import type { CampaignIndex } from './types'

/**
 * Byte offsets of fixed-size fields, after the 8-byte account discriminator.
 * They mirror state.rs; tests in program/tests/litesvm check the Campaign ones.
 */
export const CAMPAIGN_OFFSETS = { organizer: 8, recipient: 40, mint: 72, campaignId: 104, status: 112 } as const
export const CONTRIBUTION_OFFSETS = { campaign: 8, contributor: 40 } as const

/** Reads straight from any RPC node with getProgramAccounts and memcmp filters. */
export class RpcCampaignIndex implements CampaignIndex {
  private readonly program: FundraiserProgram

  constructor(program: FundraiserProgram) {
    this.program = program
  }

  async campaigns(): Promise<Campaign[]> {
    // `.all()` is getProgramAccounts filtered by the Campaign discriminator;
    // the memcmp keeps it to campaigns raising this deployment's USDC.
    const accounts = await this.program.account.campaign.all([
      { memcmp: { offset: CAMPAIGN_OFFSETS.mint, bytes: USDC_MINT.toBase58() } },
    ])
    return accounts
      .map((a) => ({ address: a.publicKey, ...(a.account as Omit<Campaign, 'address'>) }))
      .sort((a, b) => b.deadline.cmp(a.deadline))
  }

  async campaign(address: PublicKey): Promise<Campaign | null> {
    const account = await this.program.account.campaign.fetchNullable(address)
    return account ? { address, ...(account as Omit<Campaign, 'address'>) } : null
  }

  async contributionsTo(campaign: PublicKey): Promise<Contribution[]> {
    const accounts = await this.program.account.contribution.all([
      { memcmp: { offset: CONTRIBUTION_OFFSETS.campaign, bytes: campaign.toBase58() } },
    ])
    return accounts
      .map((a) => ({ address: a.publicKey, ...(a.account as Omit<Contribution, 'address'>) }))
      .sort((a, b) => b.amount.cmp(a.amount))
  }

  async campaignsContributedBy(wallet: PublicKey): Promise<Set<string>> {
    const accounts = await this.program.account.contribution.all([
      { memcmp: { offset: CONTRIBUTION_OFFSETS.contributor, bytes: wallet.toBase58() } },
    ])
    return new Set(accounts.map((a) => (a.account.campaign as PublicKey).toBase58()))
  }

  async allContributions(): Promise<Contribution[]> {
    const accounts = await this.program.account.contribution.all()
    return accounts.map((a) => ({ address: a.publicKey, ...(a.account as Omit<Contribution, 'address'>) }))
  }
}
