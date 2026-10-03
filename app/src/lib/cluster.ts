import { clusterApiUrl } from '@solana/web3.js'

/** Devnet only. There is deliberately no mainnet switch in this app. */
export const CLUSTER = 'devnet' as const
export const RPC_ENDPOINT = clusterApiUrl(CLUSTER)

export const explorerTx = (signature: string) =>
  `https://explorer.solana.com/tx/${signature}?cluster=${CLUSTER}`

export const explorerAddress = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`
