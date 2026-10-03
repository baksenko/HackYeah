import { useEffect, useState } from 'react'

import { explorerAddress } from '../lib/cluster'

/**
 * A full address, never shortened, with a way to copy it. Anywhere a user
 * has to decide who money goes to or comes from, they should be able to
 * compare every character against what they expect.
 */
export function Address({
  address,
  you = false,
  explorer = false,
}: {
  address: string
  you?: boolean
  explorer?: boolean
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(id)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Clipboard can be blocked (insecure context, permissions). The address
      // is still fully visible and selectable, so there is nothing to recover.
    }
  }

  return (
    <span className="address">
      <span className="mono address-text">{address}</span>
      {you && <span className="you"> you</span>}
      <span className="address-actions">
        <button type="button" className="link-button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {explorer && (
          <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
            Explorer
          </a>
        )}
      </span>
    </span>
  )
}
