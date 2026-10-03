import { useState } from 'react'
import { Link } from 'react-router-dom'

import { campaignStatus, isPrivate, secondsLeft, type Campaign } from '../lib/campaign'
import { formatCountdown, shortKey } from '../lib/format'
import { decodeTags } from '../lib/tags'
import { Progress } from './Progress'
import { StatusBadge } from './StatusBadge'

export function CampaignCard({ campaign, now }: { campaign: Campaign; now: number }) {
  const status = campaignStatus(campaign, now)
  const left = secondsLeft(campaign, now)
  const priv = isPrivate(campaign)
  const tags = decodeTags(campaign.tags)
  const lead = tags[0]
  const [photoFailed, setPhotoFailed] = useState(false)
  const photo = campaign.imageUrl && !photoFailed ? campaign.imageUrl : null

  return (
    <Link to={`/c/${campaign.address.toBase58()}`} className="card">
      <div className={`card-banner ${priv ? 'banner-private' : 'banner-public'}`}>
        {photo && (
          <img
            className="card-photo"
            src={photo}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setPhotoFailed(true)}
          />
        )}
        <span className="card-kind">{priv ? '🔒 Friends' : '🌍 Crowdfunding'}</span>
        <StatusBadge status={status} />
        {lead && !photo && (
          <span className="card-emoji" aria-hidden>
            {lead.emoji}
          </span>
        )}
      </div>
      <div className="card-body">
        {tags.length > 0 && (
          <p className="card-tags">{tags.map((t) => t.label).join(' · ')}</p>
        )}
        <h3>{campaign.title}</h3>
        <Progress campaign={campaign} />
        <p className="card-meta">
          {status === 'open'
            ? `Closes in ${formatCountdown(left)}`
            : `Closed ${formatCountdown(-left)} ago`}
          {' · for '}
          {shortKey(campaign.recipient.toBase58())}
        </p>
      </div>
    </Link>
  )
}
