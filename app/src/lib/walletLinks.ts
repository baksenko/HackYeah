/**
 * Where a scanned QR code opens a campaign page. A phone camera opening a
 * wallet's "browse" universal link shows the page inside that wallet's
 * in-app browser, already able to sign -- the closest a static site can get
 * to a Solana Pay transaction request (see lib/actions.ts).
 *
 * Formats from the wallets' own docs:
 *   Phantom:  https://phantom.app/ul/browse/<url>?ref=<ref>
 *   Solflare: https://solflare.com/ul/v1/browse/<url>?ref=<ref>
 * with <url> and <ref> URL-encoded.
 */
export type QrTarget = 'browser' | 'phantom' | 'solflare'

export const QR_TARGETS: { id: QrTarget; label: string }[] = [
  { id: 'browser', label: 'Any browser' },
  { id: 'phantom', label: 'Phantom app' },
  { id: 'solflare', label: 'Solflare app' },
]

export function qrLink(target: QrTarget, pageUrl: string): string {
  const url = encodeURIComponent(pageUrl)
  const ref = encodeURIComponent(new URL(pageUrl).origin)
  switch (target) {
    case 'phantom':
      return `https://phantom.app/ul/browse/${url}?ref=${ref}`
    case 'solflare':
      return `https://solflare.com/ul/v1/browse/${url}?ref=${ref}`
    default:
      return pageUrl
  }
}

/** A phone cannot open a page served from this computer's localhost. */
export const isLocalOnly = (pageUrl: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(pageUrl).hostname)
