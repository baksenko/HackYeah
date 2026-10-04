import { PublicKey } from '@solana/web3.js'

/**
 * A Solana Pay transfer request, as a store would show it:
 *   solana:<recipient>?amount=<decimal>&spl-token=<mint>&reference=<key>&label=..&message=..
 * (https://docs.solanapay.com/spec). Only the parts this app uses are kept.
 */
export type PaymentRequest = {
  recipient: PublicKey
  /** The decimal amount exactly as written in the link, e.g. "120.50". */
  amount: string | null
  /** The token the request asks for; null means SOL. */
  splToken: PublicKey | null
  /** Keys the store watches for; any of them identifies the payment. */
  references: PublicKey[]
  label: string | null
  message: string | null
}

export const looksLikeSolanaPay = (text: string) => text.trim().toLowerCase().startsWith('solana:')

/** Parses a Solana Pay transfer request URL. Throws a readable error if it is not one. */
export function parseSolanaPayUrl(text: string): PaymentRequest {
  const trimmed = text.trim()
  if (!looksLikeSolanaPay(trimmed)) throw new Error('A Solana Pay link starts with "solana:".')
  const rest = trimmed.slice('solana:'.length)
  const [path, query = ''] = rest.split('?', 2)
  if (path.startsWith('http')) {
    throw new Error('This is a Solana Pay transaction request, not a payment address. Ask for a transfer link instead.')
  }

  let recipient: PublicKey
  try {
    recipient = new PublicKey(decodeURIComponent(path))
  } catch {
    throw new Error('The Solana Pay link does not contain a valid recipient address.')
  }

  const params = new URLSearchParams(query)
  const key = (name: string) => {
    const value = params.get(name)
    if (!value) return null
    try {
      return new PublicKey(value)
    } catch {
      throw new Error(`The Solana Pay link has an invalid ${name}.`)
    }
  }
  const amount = params.get('amount')
  if (amount !== null && !/^\d+(\.\d+)?$/.test(amount)) throw new Error('The Solana Pay link has an invalid amount.')

  return {
    recipient,
    amount,
    splToken: key('spl-token'),
    references: params.getAll('reference').map((value) => {
      try {
        return new PublicKey(value)
      } catch {
        throw new Error('The Solana Pay link has an invalid reference.')
      }
    }),
    label: params.get('label'),
    message: params.get('message'),
  }
}

const referenceKey = (campaign: PublicKey) => `chipin:reference:${campaign.toBase58()}`

/**
 * Remembers a payment request's reference for a campaign, in this browser
 * only. The program does not store it; `withdraw` simply carries it so the
 * store can find the payout. Anyone can trigger the payout, so a payout from
 * another browser just goes out without it.
 */
export function rememberReference(campaign: PublicKey, reference: PublicKey) {
  try {
    localStorage.setItem(referenceKey(campaign), reference.toBase58())
  } catch {
    // Storage blocked: the payout still works, only without the reference.
  }
}

export function recallReference(campaign: PublicKey): PublicKey | null {
  try {
    const value = localStorage.getItem(referenceKey(campaign))
    return value ? new PublicKey(value) : null
  } catch {
    return null
  }
}
