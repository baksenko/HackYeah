import { useState } from 'react'

/**
 * A campaign's photo. Only the link is on chain; the image itself is hosted
 * elsewhere, so the caption names the host and a broken link simply hides.
 */
export function CampaignPhoto({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return null

  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }

  return (
    <figure className="campaign-photo">
      <img
        src={url}
        alt={`Photo for ${title}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
      <figcaption className="aside">
        Photo hosted at {host}. Only its link is stored on chain.
      </figcaption>
    </figure>
  )
}
