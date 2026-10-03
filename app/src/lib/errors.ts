import idlJson from '../idl/fundraiser.json'

/** Error number -> name/message, straight from the deployed program's IDL. */
const BY_CODE = new Map<number, { name: string; msg: string }>(
  (idlJson.errors ?? []).map((e) => [e.code, { name: e.name, msg: e.msg }]),
)

/** Plain-language gloss for the errors a user can actually trigger. */
const PLAIN_LANGUAGE: Record<string, string> = {
  DeadlineNotReached: 'The deadline has not passed yet, so the money cannot be paid out.',
  DeadlinePassed: 'This campaign is closed, so it cannot take new contributions.',
  GoalNotReached: 'The goal was not reached, so there is nothing to withdraw — contributors can take their money back instead.',
  GoalReached: 'The goal was reached, so the money belongs to the recipient and cannot be refunded.',
  NotRecipient: 'Only the recipient chosen when this campaign was created can withdraw.',
  AlreadyWithdrawn: 'The money has already been paid out.',
  AccountNotInitialized: 'There is no contribution left to refund — it was already paid back.',
}

export type ProgramFailure = {
  /** e.g. "DeadlineNotReached". The program's own name for the rule that fired. */
  name: string
  /** The program's error message. */
  message: string
  /** A sentence a non-technical user can read. */
  plain: string
}

/**
 * Works out which on-chain rule rejected a transaction, from whatever the
 * cluster gave us: Anchor's thrown error, or the raw program logs of a
 * transaction that landed and failed.
 */
export function explainFailure(input: unknown, logs?: string[] | null): ProgramFailure {
  const name = findErrorName(input, logs)
  const known = name ? [...BY_CODE.values()].find((e) => e.name === name) : undefined

  const fallback =
    typeof input === 'object' && input && 'message' in input
      ? String((input as { message: unknown }).message)
      : 'The transaction was rejected.'

  return {
    name: name ?? 'Unknown',
    message: known?.msg ?? fallback,
    plain: (name && PLAIN_LANGUAGE[name]) || known?.msg || fallback,
  }
}

function findErrorName(input: unknown, logs?: string[] | null): string | null {
  // 1. Anchor already parsed it for us.
  const code = (input as { error?: { errorCode?: { code?: string } } })?.error?.errorCode?.code
  if (typeof code === 'string') return code

  const haystack = [
    ...(logs ?? []),
    ...((input as { logs?: string[] })?.logs ?? []),
    String((input as { message?: unknown })?.message ?? ''),
  ].join('\n')

  // 2. Anchor's log line: "... Error Code: DeadlineNotReached. Error Number: 6000."
  const byName = haystack.match(/Error Code: (\w+)/)
  if (byName) return byName[1]

  // 3. Bare custom error: "custom program error: 0x1770"
  const byHex = haystack.match(/custom program error: 0x([0-9a-fA-F]+)/)
  if (byHex) return BY_CODE.get(Number.parseInt(byHex[1], 16))?.name ?? null

  const byDec = haystack.match(/"Custom":\s*(\d+)/)
  if (byDec) return BY_CODE.get(Number(byDec[1]))?.name ?? null

  // 4. Anchor's own constraint errors, which have no entry in our IDL.
  if (/AccountNotInitialized|account to be already initialized/i.test(haystack)) {
    return 'AccountNotInitialized'
  }
  return null
}
