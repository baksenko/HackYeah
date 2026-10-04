import type { Campaign } from '../lib/campaign'
import { formatUsdc } from '../lib/format'
import { progressRatio } from '../lib/campaign'

export function Progress({ campaign }: { campaign: Campaign }) {
  const ratio = progressRatio(campaign)
  const percent = Math.round(ratio * 100)

  return (
    <div className="progress">
      <div className="progress-track">
        <div
          className={`progress-fill ${ratio >= 1 ? 'progress-full' : ''}`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
      <div className="progress-labels">
        <span>
          <strong>{formatUsdc(campaign.totalRaised)}</strong> of {formatUsdc(campaign.goal)}
        </span>
        <span>{percent}%</span>
      </div>
    </div>
  )
}
