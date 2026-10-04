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
  /** Must appear in the payment transaction as an SPL Memo instruction. */
  memo: string | null
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
    memo: params.get('memo'),
  }
}

/** What a shop's link sets on a campaign, ready to lock in the create form. */
export type ShopRequest = {
  /** The link itself; goes in the recipient field, so the usual parsing applies. */
  link: string
  request: PaymentRequest
  /** From the shop's label, cut to the program's title limit. */
  title: string
  /** The order amount as typed in the link, e.g. "42.50". */
  amount: string
}

/** Cuts text to at most `maxBytes` of UTF-8 without splitting a character. */
function cutToBytes(text: string, maxBytes: number): string {
  let out = ''
  for (const ch of text) {
    if (new TextEncoder().encode(out + ch).length > maxBytes) break
    out += ch
  }
  return out
}

/**
 * Checks a shop's Solana Pay transfer link for the merchant entry point
 * (/create?pay=...). Returns what it sets, or a plain-language reason the
 * order cannot be paid with Chip In.
 */
export function readShopRequest(
  link: string,
  usdcMint: PublicKey,
  limits: { titleBytes: number; memoBytes: number },
): ShopRequest | { error: string } {
  let request: PaymentRequest
  try {
    request = parseSolanaPayUrl(link)
  } catch (e) {
    return { error: `The shop's payment link could not be read: ${e instanceof Error ? e.message : 'it is not valid.'}` }
  }
  if (!request.splToken) {
    return {
      error:
        'This shop asks to be paid in SOL. Chip In collects USDC only, so it cannot pay this order. Ask the shop for a USDC payment link.',
    }
  }
  if (!request.splToken.equals(usdcMint)) {
    return {
      error:
        'This shop asks to be paid in a token other than USDC. Chip In collects USDC only, so it cannot pay this order. Ask the shop for a USDC payment link.',
    }
  }
  if (!request.amount) return { error: "The shop's payment link does not say how much to pay." }
  if (!/^\d+(\.\d{1,6})?$/.test(request.amount) || Number(request.amount) <= 0) {
    return { error: `The shop's amount (${request.amount}) is not a valid USDC amount.` }
  }
  if (request.memo && new TextEncoder().encode(request.memo).length > limits.memoBytes) {
    return { error: `The shop's memo is longer than ${limits.memoBytes} bytes, which campaigns cannot store.` }
  }
  const label = request.label?.trim() || `Payment to ${request.recipient.toBase58().slice(0, 4)}…`
  return { link, request, title: cutToBytes(label, limits.titleBytes), amount: request.amount }
}
