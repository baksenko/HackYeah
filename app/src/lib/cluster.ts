import { clusterApiUrl } from '@solana/web3.js'

/**
 * Devnet by default and in the demo. `VITE_RPC_ENDPOINT` exists only so the
 * app can be pointed at a local `solana-test-validator` while developing;
 * there is no mainnet option anywhere in this app.
 */
const override = import.meta.env.VITE_RPC_ENDPOINT as string | undefined

export const RPC_ENDPOINT = override ?? clusterApiUrl('devnet')
export const IS_DEVNET = !override

/** Explorer needs to be told explicitly when it is looking at a local node. */
const CLUSTER_QUERY = IS_DEVNET
  ? 'cluster=devnet'
  : `cluster=custom&customUrl=${encodeURIComponent(RPC_ENDPOINT)}`

export const CLUSTER_LABEL = IS_DEVNET ? 'Solana devnet' : 'local validator'

export const explorerTx = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?${CLUSTER_QUERY}`

export const explorerAddress = (address: string) =>
  `https://explorer.solana.com/address/${address}?${CLUSTER_QUERY}`
