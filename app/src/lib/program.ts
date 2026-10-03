import { AnchorProvider, Program, type Idl } from '@coral-xyz/anchor'
import { useConnection, useAnchorWallet } from '@solana/wallet-adapter-react'
import { Keypair, PublicKey } from '@solana/web3.js'
import { useMemo } from 'react'

import idlJson from '../idl/fundraiser.json'
import type { Fundraiser } from '../idl/fundraiser'

export const PROGRAM_ID = new PublicKey(idlJson.address)

export const CAMPAIGN_SEED = Buffer.from('campaign')
export const CONTRIBUTION_SEED = Buffer.from('contribution')
export const MAX_TITLE_BYTES = 64

export type FundraiserProgram = Program<Fundraiser>

/**
 * The program client. Works without a connected wallet too, so browsing
 * campaigns does not require connecting anything -- a read-only provider gets
 * a throwaway keypair it will never be asked to sign with.
 */
export function useProgram(): FundraiserProgram {
  const { connection } = useConnection()
  const wallet = useAnchorWallet()

  return useMemo(() => {
    const readOnlyWallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: () => Promise.reject(new Error('Connect a wallet first')),
      signAllTransactions: () => Promise.reject(new Error('Connect a wallet first')),
    }
    const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet, {
      commitment: 'confirmed',
    })
    return new Program(idlJson as Idl, provider) as unknown as FundraiserProgram
  }, [connection, wallet])
}

export function campaignPda(organizer: PublicKey, campaignId: bigint): PublicKey {
  const idBytes = Buffer.alloc(8)
  idBytes.writeBigUInt64LE(campaignId)
  return PublicKey.findProgramAddressSync(
    [CAMPAIGN_SEED, organizer.toBuffer(), idBytes],
    PROGRAM_ID,
  )[0]
}

export function contributionPda(campaign: PublicKey, contributor: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [CONTRIBUTION_SEED, campaign.toBuffer(), contributor.toBuffer()],
    PROGRAM_ID,
  )[0]
}
