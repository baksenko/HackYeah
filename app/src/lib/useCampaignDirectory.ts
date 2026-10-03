import { useWallet } from '@solana/wallet-adapter-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { fetchCampaigns, fetchMyCampaignKeys, isPrivate, type Campaign } from './campaign'
import { recallInvite } from './invite'
import { useProgram } from './program'

/**
 * Every campaign this viewer may see listed: all public ones, plus the
 * private ones they are already part of (organizer, recipient, contributor,
 * or a browser holding a matching invite).
 *
 * This only decides what the app *lists*. Who can *contribute* to a private
 * campaign is enforced by the program, not here.
 */
export function useCampaignDirectory() {
  const program = useProgram()
  const { publicKey } = useWallet()

  const [all, setAll] = useState<Campaign[] | null>(null)
  const [joined, setJoined] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setError(null)
      const [campaigns, mine] = await Promise.all([
        fetchCampaigns(program),
        publicKey ? fetchMyCampaignKeys(program, publicKey) : Promise.resolve(new Set<string>()),
      ])
      setAll(campaigns)
      setJoined(mine)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read campaigns from the chain.')
    }
  }, [program, publicKey])

  useEffect(() => {
    void reload()
  }, [reload])

  const { publicCampaigns, myPrivate } = useMemo(() => {
    const list = all ?? []
    const isMine = (c: Campaign) =>
      (!!publicKey && (c.organizer.equals(publicKey) || c.recipient.equals(publicKey))) ||
      joined.has(c.address.toBase58()) ||
      !!recallInvite(c.address)?.publicKey.equals(c.invite!)
    return {
      publicCampaigns: list.filter((c) => !isPrivate(c)),
      myPrivate: list.filter((c) => isPrivate(c) && isMine(c)),
    }
  }, [all, joined, publicKey])

  return {
    loading: all === null && !error,
    error,
    reload,
    publicCampaigns,
    myPrivate,
    visible: [...myPrivate, ...publicCampaigns],
  }
}
