import { formatSol } from '../lib/format'
import { Address } from './Address'

export type CostLine = {
  label: string
  lamports: number
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

const signed = (lamports: number) =>
  `${lamports < 0 ? '−' : '+'}${formatSol(Math.abs(lamports), 9)}`

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
  const net = view.lines.reduce(
    (sum, line) => sum + (line.direction === 'in' ? line.lamports : -line.lamports),
    0,
  )

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
              <td className="right">{signed(line.direction === 'in' ? line.lamports : -line.lamports)}</td>
            </tr>
          ))}
          <tr className="review-total">
            <td>Change to your wallet</td>
            <td className="right">{signed(net)}</td>
          </tr>
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
