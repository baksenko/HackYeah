import type { Keypair, PublicKey } from '@solana/web3.js'
import { QRCodeSVG } from 'qrcode.react'
import { useRef, useState } from 'react'

import { shareUrl } from '../lib/invite'
import { QR_TARGETS, isLocalOnly, qrLink, type QrTarget } from '../lib/walletLinks'

/**
 * Link + QR code for inviting people. For a private campaign the link carries
 * the invite secret, so this is only ever rendered for someone who has it.
 */
export function SharePanel({
  campaign,
  title,
  invite,
}: {
  campaign: PublicKey
  title: string
  invite: Keypair | null
}) {
  const url = shareUrl(campaign, invite)
  const [target, setTarget] = useState<QrTarget>('browser')
  const qrValue = qrLink(target, url)
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the link is selectable in the box below.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, text: `Chip in: ${title}`, url })
    } catch {
      // User closed the share sheet.
    }
  }

  function downloadQr() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `chip-in-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'campaign'}.svg`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section className="panel share">
      <div className="share-qr" ref={qrRef}>
        <QRCodeSVG value={qrValue} size={176} level="M" marginSize={2} fgColor="#2e1065" />
        <div className="qr-targets" role="radiogroup" aria-label="Where the QR code opens">
          {QR_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={target === t.id}
              className={`chip ${target === t.id ? 'chip-on' : ''}`}
              onClick={() => setTarget(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="share-body">
        <h2>{invite ? 'Invite your friends' : 'Share this campaign'}</h2>
        <p className="aside">
          {invite
            ? 'This link is the key to the campaign. Anyone who has it — or scans the QR code — can contribute, so send it only to the people you want in.'
            : 'Anyone can open this link or scan the code to see the campaign and chip in.'}{' '}
          {target !== 'browser' &&
            `Scanned with a phone camera, the code opens this page inside the ${target === 'phantom' ? 'Phantom' : 'Solflare'} app, ready to contribute.`}
        </p>
        {isLocalOnly(url) && (
          <p className="aside warn">
            This app is running on this computer, so a phone cannot open the link yet. It works
            once the app is hosted somewhere public.
          </p>
        )}
        <input className="share-url mono" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="share-actions">
          <button className="button button-primary" onClick={() => void copy()}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          {canNativeShare && (
            <button className="button button-secondary" onClick={() => void nativeShare()}>
              Share…
            </button>
          )}
          <button className="button button-secondary" onClick={downloadQr}>
            Download QR
          </button>
        </div>
      </div>
    </section>
  )
}
