import { BN } from '@coral-xyz/anchor'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

/**
 * Everything the user sees is in SOL. Lamports never reach the screen.
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

export function solToLamports(sol: string | number): BN {
  const value = typeof sol === 'string' ? Number.parseFloat(sol) : sol
  if (!Number.isFinite(value) || value <= 0) throw new Error('Enter an amount greater than zero')
  // Round rather than truncate, so 0.1 does not become 99999999 lamports.
  return new BN(Math.round(value * LAMPORTS_PER_SOL))
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
