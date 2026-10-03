import { CLUSTER_LABEL, explorerTx } from '../lib/cluster'
import type { TxOutcome } from '../lib/send'

/**
 * Every action reports back through this: what happened, and a link to the
 * proof on Solana Explorer whenever a transaction actually reached the chain.
 */
export function TxResult({ outcome, onDismiss }: { outcome: TxOutcome; onDismiss?: () => void }) {
  if (outcome.kind === 'success') {
    return (
      <div className="notice notice-success">
        <strong>Done.</strong> The transaction was confirmed on the {CLUSTER_LABEL}.
        <a href={explorerTx(outcome.signature)} target="_blank" rel="noreferrer">
          View it on Solana Explorer →
        </a>
        {onDismiss && <button className="link-button" onClick={onDismiss}>Dismiss</button>}
      </div>
    )
  }

  if (outcome.kind === 'failed-on-chain') {
    return (
      <div className="notice notice-blocked">
        <strong>The program refused it.</strong>
        <p>{outcome.failure.plain}</p>
        <p className="mono">
          Error from the on-chain program: <code>{outcome.failure.name}</code>
        </p>
        <a href={explorerTx(outcome.signature)} target="_blank" rel="noreferrer">
          See the failed transaction on Solana Explorer →
        </a>
        <p className="aside">
          This transaction really was submitted and really was rejected by the program
          on chain — not hidden by this web page.
        </p>
        {onDismiss && <button className="link-button" onClick={onDismiss}>Dismiss</button>}
      </div>
    )
  }

  return (
    <div className="notice notice-error">
      <strong>Nothing was sent.</strong>
      <p>{outcome.failure.plain}</p>
      {outcome.failure.name !== 'Unknown' && (
        <p className="mono">
          Reason: <code>{outcome.failure.name}</code>
        </p>
      )}
      {onDismiss && <button className="link-button" onClick={onDismiss}>Dismiss</button>}
    </div>
  )
}
