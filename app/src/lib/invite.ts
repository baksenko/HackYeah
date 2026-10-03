import { utils } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'

/**
 * Private campaigns: the share link carries the invite key's *secret* in the
 * URL fragment (`#invite=…`). Browsers never send the fragment to any server,
 * so the secret only ever travels from the organizer's screen to a friend's.
 *
 * Holding it lets you co-sign `contribute` for that one campaign. It holds no
 * money and grants nothing else.
 */

const storageKey = (campaign: PublicKey) => `chipin:invite:${campaign.toBase58()}`

export function encodeInvite(invite: Keypair): string {
  return utils.bytes.bs58.encode(invite.secretKey)
}

function decodeInvite(text: string): Keypair | null {
  try {
    return Keypair.fromSecretKey(utils.bytes.bs58.decode(text))
  } catch {
    return null
  }
}

/** The invite in the current URL, if any. */
export function inviteFromHash(hash: string): Keypair | null {
  const match = hash.match(/invite=([1-9A-HJ-NP-Za-km-z]+)/)
  return match ? decodeInvite(match[1]) : null
}

/**
 * Remembers an invite in this browser so the organizer, or a friend who
 * already opened the link, can come back without the link. Convenience
 * only: losing it never puts money at risk, since refunds need no invite.
 */
export function rememberInvite(campaign: PublicKey, invite: Keypair) {
  try {
    localStorage.setItem(storageKey(campaign), encodeInvite(invite))
  } catch {
    // Storage blocked (private window etc.). The link still works.
  }
}

export function recallInvite(campaign: PublicKey): Keypair | null {
  try {
    const stored = localStorage.getItem(storageKey(campaign))
    return stored ? decodeInvite(stored) : null
  } catch {
    return null
  }
}

/** Public campaigns: a plain link. Private: the link plus the invite secret. */
export function shareUrl(campaign: PublicKey, invite: Keypair | null): string {
  const base = `${window.location.origin}/c/${campaign.toBase58()}`
  return invite ? `${base}#invite=${encodeInvite(invite)}` : base
}

const NICKNAME_KEY = 'chipin:nickname'

export function rememberNickname(nickname: string) {
  try {
    localStorage.setItem(NICKNAME_KEY, nickname)
  } catch {
    /* convenience only */
  }
}

export function recallNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? ''
  } catch {
    return ''
  }
}
