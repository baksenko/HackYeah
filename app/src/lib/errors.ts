import idlJson from '../idl/fundraiser.json'
import { formatUsdc } from './format'

/** Error number -> name/message, straight from the deployed program's IDL. */
const BY_CODE = new Map<number, { name: string; msg: string }>(
  (idlJson.errors ?? []).map((e) => [e.code, { name: e.name, msg: e.msg }]),
)

/** Plain-language gloss for the errors a user can actually trigger. */
const PLAIN_LANGUAGE: Record<string, string> = {
  DeadlineNotReached: 'The deadline has not passed yet, so refunds are not open.',
  DeadlinePassed: 'This campaign is closed, so it cannot take new contributions.',
  GoalNotReached: 'The goal has not been reached, so the money cannot be paid out yet.',
  GoalReached: 'The goal was reached, so the money belongs to the recipient: it cannot be refunded or cancelled.',
  NotRecipient: 'The money can only ever go to the recipient chosen for this campaign.',
  AlreadyWithdrawn: 'The money has already been paid out to the recipient.',
  CampaignNotActive: 'This campaign is no longer taking contributions or changes.',
  CampaignCancelled: 'The organizer cancelled this campaign, so everyone can take their money back instead.',
  RecipientLocked: 'The recipient can only be changed before anyone contributes.',
  RecipientChanged: 'The organizer changed the recipient since you opened this page. Reload and check who the money goes to.',
  InvalidRecipient: 'Enter a real Solana address for the recipient.',
  NotOrganizer: 'Only the organizer of this campaign can do that.',
  WrongMint: 'This program only accepts USDC.',
  ExceedsGoal: 'That is more than the campaign still needs. Contributions stop exactly at the goal.',
  MemoTooLong: "The shop's memo is too long: the program allows 64 bytes.",
  ReferenceRequired: "This payout must carry the shop's payment reference. Reload the page and try again.",
  WrongReference: "That is not this campaign's payment reference. Reload the page and try again.",
  NoUsdcAccount: 'Your wallet has no USDC yet. Get some USDC first, then try again.',
  NotEnoughUsdc: 'Your wallet does not hold enough USDC for this.',
  DescriptionTooLong: 'The description is too long: the program allows 300 bytes.',
  ImageUrlTooLong: 'The photo link is too long: the program allows 200 bytes.',
  InvalidImageUrl: 'The photo link must start with https://.',
  AccountNotInitialized: 'There is no contribution left to refund — it was already paid back.',
  InviteRequired: 'This campaign is private. Only people with the organizer’s invite link can contribute — and the program, not this page, enforces that.',
  InvalidInvite: 'That invite link belongs to a different campaign.',
  NicknameTooLong: 'Your nickname can be at most 32 characters.',
  WalletHasNoSol:
    'Your wallet has no SOL on this network, so it cannot even pay the transaction fee. Use “Get test SOL” at the top of the page, and check your wallet is set to the same network as this app.',
  NotEnoughSol: 'Your wallet does not hold enough SOL for the fee and deposit. Use “Get test SOL” at the top of the page.',
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
  let name = findErrorName(input, logs)
  // A missing USDC account to pay from is not a missing receipt.
  if (name === 'AccountNotInitialized' && /contributor_token/.test(describe(input, logs))) {
    name = 'NoUsdcAccount'
  }
  const known = name ? [...BY_CODE.values()].find((e) => e.name === name) : undefined

  const fallback =
    typeof input === 'object' && input && 'message' in input
      ? String((input as { message: unknown }).message)
      : 'The transaction was rejected.'

  // The program logs how much is still needed when it refuses an over-goal
  // contribution; say it in USDC.
  const remaining = name === 'ExceedsGoal' ? /Only (\d+) base units/.exec(describe(input, logs)) : null
  return {
    name: name ?? 'Unknown',
    message: known?.msg ?? fallback,
    plain: remaining
      ? `Only ${formatUsdc(BigInt(remaining[1]))} is still needed to reach the goal. Contribute that much or less.`
      : (name && PLAIN_LANGUAGE[name]) || known?.msg || fallback,
  }
}

/** Everything an error carries, as one searchable string. */
function describe(input: unknown, logs?: string[] | null): string {
  const e = input as { logs?: string[]; message?: unknown; error?: { origin?: unknown } }
  return [...(logs ?? []), ...(e?.logs ?? []), String(e?.message ?? ''), String(e?.error?.origin ?? '')].join('\n')
}

function findErrorName(input: unknown, logs?: string[] | null): string | null {
  // 1. Anchor already parsed it for us.
  const code = (input as { error?: { errorCode?: { code?: string } } })?.error?.errorCode?.code
  if (typeof code === 'string') return code

  const haystack = describe(input, logs)

  // The token program's own failure: not enough USDC in the paying account.
  if (/Error: insufficient funds/i.test(haystack)) return 'NotEnoughUsdc'

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

  // 5. Bank-level rejections that happen before the program ever runs, so they
  //    carry no program logs at all. "No record of a prior credit" is how the
  //    runtime says the fee payer has never held any SOL on this cluster.
  if (/no record of a prior credit|InsufficientFundsForFee|Insufficient funds for fee/i.test(haystack)) {
    return 'WalletHasNoSol'
  }
  if (/insufficient lamports|Insufficient Funds/i.test(haystack)) {
    return 'NotEnoughSol'
  }
  return null
}
