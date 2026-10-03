import { STATUS_LABEL, type CampaignStatus } from '../lib/campaign'

export function StatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
}
