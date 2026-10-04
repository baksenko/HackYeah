import { BN } from '@coral-xyz/anchor'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

/** USDC has 6 decimals on every cluster (USDC_DECIMALS in the program). */
export const USDC_DECIMALS = 6
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS)

const toBigInt = (v: BN | number | bigint): bigint =>
  typeof v === 'bigint' ? v : BigInt(typeof v === 'number' ? Math.trunc(v) : v.toString())

/**
 * Campaign money is USDC: "12.5 USDC". Exact -- base units are split with
 * integer arithmetic, never through a float. Shows up to `maxDecimals`
 * places, trailing zeros trimmed.
 */
export function formatUsdc(baseUnits: BN | number | bigint, maxDecimals = 2): string {
  const value = toBigInt(baseUnits)
  const negative = value < 0n
  const abs = negative ? -value : value
  const whole = (abs / USDC_UNIT).toLocaleString()
  const fraction = (abs % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0').slice(0, maxDecimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''} USDC`
}

/**
 * USDC base units as a plain decimal for an input box: "12.5", "1000" --
 * no thousands separators and no unit, so parseUsdc reads it back exactly.
 */
export function usdcInputValue(baseUnits: BN | bigint): string {
  const value = toBigInt(baseUnits)
  const fraction = (value % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return `${value / USDC_UNIT}${fraction ? `.${fraction}` : ''}`
}

/**
 * Parses what a person typed ("12", "12.5", "0,25") into USDC base units.
 * Exact, so 0.1 is 100000 and never 99999.
 */
export function parseUsdc(text: string): BN {
  const cleaned = text.trim().replace(',', '.')
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cleaned)
  if (!match) throw new Error('Enter an amount like 25 or 12.50 (at most 6 decimal places)')
  const units = BigInt(match[1]) * USDC_UNIT + BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0'))
  if (units <= 0n) throw new Error('Enter an amount greater than zero')
  return new BN(units.toString())
}

/**
 * Network fees and account deposits are paid in SOL. Lamports never reach
 * the screen.
 */
export function toSol(lamports: BN | number | bigint): number {
  const n = typeof lamports === 'object' ? Number(lamports.toString()) : Number(lamports)
  return n / LAMPORTS_PER_SOL
}

export function formatSol(lamports: BN | number | bigint, maxDecimals = 4): string {
  const sol = toSol(lamports)
  const text = sol.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  })
  return `${text} SOL`
}

/** Shortens a key for display without hiding it entirely. */
export const shortKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`

/** "2 days, 4 hours" / "47 seconds" / "the deadline has passed" */
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'the deadline has passed'
  const d = Math.floor(secondsLeft / 86400)
  const h = Math.floor((secondsLeft % 86400) / 3600)
  const m = Math.floor((secondsLeft % 3600) / 60)
  const s = Math.floor(secondsLeft % 60)

  const parts: string[] = []
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`)
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`)
  if (!d && m) parts.push(`${m} minute${m === 1 ? '' : 's'}`)
  if (!d && !h && s) parts.push(`${s} second${s === 1 ? '' : 's'}`)
  return parts.slice(0, 2).join(', ') || 'less than a second'
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString()
}
