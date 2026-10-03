import { useMemo } from 'react'

import { useProgram } from '../program'
import { RpcCampaignIndex } from './rpc'
import type { CampaignIndex } from './types'

export type { CampaignIndex } from './types'

/**
 * The campaign index the app uses. To switch to an indexing service, return
 * a different `CampaignIndex` implementation here.
 */
export function useCampaignIndex(): CampaignIndex {
  const program = useProgram()
  return useMemo(() => new RpcCampaignIndex(program), [program])
}
