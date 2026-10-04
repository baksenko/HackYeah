import { formatSol, formatUsdc } from '../lib/format'
import { Address } from './Address'

export type CostLine = {
  label: string
  /** Campaign money is USDC; network fees and account deposits are SOL. */
  asset: 'usdc' | 'sol'
  /** In base units of `asset`: USDC's 6 decimals, or lamports. */
  amount: number
  /** `out` leaves the connected wallet, `in` arrives in it. */
  direction: 'out' | 'in'
  note?: string
}

/** Everything a person should see before their wallet asks them to sign. */
export type ReviewView = {
  heading: string
  lines: CostLine[]
  /** Where the money goes or comes from, shown in full. */
  parties: { label: string; address: string }[]
  /** What can and cannot be undone once this is signed. */
  facts: string[]
  confirmLabel: string
  danger?: boolean
}

const signed = (asset: CostLine['asset'], amount: number) =>
  `${amount < 0 ? '−' : '+'}${asset === 'usdc' ? formatUsdc(Math.abs(amount), 6) : formatSol(Math.abs(amount), 9)}`

export function ReviewPanel({
  view,
  busy,
  onConfirm,
  onBack,
}: {
  view: ReviewView
  busy: boolean
  onConfirm: () => void
  onBack: () => void
}) {
  // One total per asset: USDC and SOL never add up into one number.
  const totals = (['usdc', 'sol'] as const)
    .map((asset) => ({
      asset,
      lines: view.lines.filter((line) => line.asset === asset),
    }))
    .filter((t) => t.lines.length > 0)
    .map((t) => ({
      asset: t.asset,
      net: t.lines.reduce((sum, line) => sum + (line.direction === 'in' ? line.amount : -line.amount), 0),
    }))

  return (
    <div className="review">
      <h3>{view.heading}</h3>

      {view.parties.map((party) => (
        <p key={party.label} className="review-party">
          <strong>{party.label}</strong>
          <Address address={party.address} explorer />
        </p>
      ))}

      <table className="table">
        <tbody>
          {view.lines.map((line) => (
            <tr key={line.label}>
              <td>
                {line.label}
                {line.note && <small className="review-note">{line.note}</small>}
              </td>
              <td className="right">
                {signed(line.asset, line.direction === 'in' ? line.amount : -line.amount)}
              </td>
            </tr>
          ))}
          {totals.map((total) => (
            <tr key={total.asset} className="review-total">
              <td>Change to your wallet{totals.length > 1 ? ` (${total.asset.toUpperCase()})` : ''}</td>
              <td className="right">{signed(total.asset, total.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="review-facts">
        {view.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>

      <div className="review-actions">
        <button
          type="button"
          className={`button ${view.danger ? 'button-danger' : 'button-primary'}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Waiting for your wallet…' : view.confirmLabel}
        </button>
        <button type="button" className="link-button" onClick={onBack} disabled={busy}>
          Back
        </button>
      </div>
      <p className="aside">
        The network fee is the cluster&apos;s own quote for this exact transaction. Your wallet
        shows the same transaction again before anything is sent.
      </p>
    </div>
  )
}
