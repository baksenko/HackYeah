import { BN } from '@coral-xyz/anchor'

import { isPrivate, type Campaign, type CampaignStatus, type Contribution } from './campaign'
import { formatDateTime, formatUsdc, shortKey } from './format'

export type Viewer = {
  isConnected: boolean
  isOrganizer: boolean
  isRecipient: boolean
  myContribution: Contribution | null
}

export type Explanation = { headline: string; points: string[] }

/**
 * The "What can happen now" panel, in plain language, derived only from
 * on-chain state. This is a description of the program's rules, never a
 * substitute for them: every sentence here corresponds to a check in
 * program/programs/fundraiser/src/instructions/.
 */
export function whatCanHappenNow(
  campaign: Campaign,
  status: CampaignStatus,
  viewer: Viewer,
): Explanation {
  const recipient = viewer.isRecipient ? 'you' : shortKey(campaign.recipient.toBase58())
  const held = campaign.totalRaised.sub(campaign.totalRefunded)
  const refundPoints = (reason: string) => {
    const points = [
      'Each contributor gets back exactly what they paid in — not a share of what is left, the exact amount.',
      'Nobody can pay this money to the recipient any more. The program refuses it.',
      'There is no deadline on claiming a refund. The money waits in the campaign account until its contributor asks for it.',
      'No invite link is needed to get money back — even from a private campaign.',
    ]
    if (viewer.myContribution) {
      points.unshift(`You contributed ${formatUsdc(viewer.myContribution.amount)}. You can take it back right now.`)
    }
    if (campaign.totalRefunded.gt(new BN(0))) {
      points.push(`${formatUsdc(campaign.totalRefunded)} of ${formatUsdc(campaign.totalRaised)} has been taken back so far.`)
    }
    return { headline: `${reason} Each contributor can take their money back. Nobody else can touch it.`, points }
  }

  switch (status) {
    case 'open': {
      const remaining = campaign.goal.sub(campaign.totalRaised)
      const points = [
        `${formatUsdc(held)} is locked in the campaign's own account. It is held by the program, not by a person — no organizer, no company, and not the people who built this app.`,
        `${formatUsdc(remaining)} still needed. As soon as the goal is reached, anyone can send the money to ${recipient} — and the program only ever sends it there.`,
        `If the goal is not reached by ${formatDateTime(campaign.deadline.toNumber())}, every contributor can take back exactly what they paid in.`,
        'The organizer can call the campaign off before the goal is reached. That only opens refunds; it cannot move any money.',
        campaign.totalRaised.gt(new BN(0))
          ? 'The recipient is locked: it cannot be changed once anyone has contributed.'
          : 'Until the first contribution, the organizer can still correct the recipient. Your contribution is refused if the recipient changes while you are on this page.',
      ]
      if (isPrivate(campaign)) {
        points.splice(
          1,
          0,
          'It is private: only people with the organizer’s invite link or QR code can contribute. The program checks the invite on every contribution, so this page could not let anyone else in even if it wanted to.',
        )
        return { headline: 'This private campaign is open to everyone with the invite link.', points }
      }
      return { headline: 'This campaign is open. Anyone can contribute.', points }
    }

    case 'succeeded':
      return {
        headline: 'The goal was reached. The money belongs to the recipient.',
        points: [
          `${formatUsdc(held)} is waiting to be sent to ${recipient}. Anyone can trigger that — the program only ever sends it to the recipient.`,
          'Nobody can redirect it — not the organizer, and not whoever contributed the most.',
          'Contributors can no longer ask for a refund, and the organizer can no longer cancel. The program refuses both.',
          'The campaign takes no more contributions.',
        ],
      }

    case 'failed':
      return refundPoints('The deadline passed without reaching the goal.')

    case 'cancelled':
      return refundPoints('The organizer cancelled this campaign before its goal was reached.')

    case 'withdrawn':
      return {
        headline: 'The money has been paid out to the recipient. This campaign is finished.',
        points: [
          `The campaign's money went to ${recipient}.`,
          'A second payout is impossible: the program recorded that it already happened.',
        ],
      }
  }
}

/** Rows for the permissions table shown under the actions. */
export const PERMISSIONS = [
  {
    action: 'Contribute',
    who: 'Anyone (public) · invite-link holders only (private)',
    when: 'While open, before the deadline and before the goal is reached',
    enforcedBy: 'contribute.rs — CampaignNotActive, DeadlinePassed, RecipientChanged, InviteRequired, WrongMint',
  },
  {
    action: 'Send the money to the recipient',
    who: 'Anyone — but only ever to the stored recipient',
    when: 'Once the goal is reached, even before the deadline; only once',
    enforcedBy: 'withdraw.rs — GoalNotReached, AlreadyWithdrawn, NotRecipient',
  },
  {
    action: 'Get my money back',
    who: 'Each contributor, for their own contribution',
    when: 'After the deadline if the goal was missed, or once cancelled',
    enforcedBy: 'refund.rs — DeadlineNotReached, GoalReached, close = contributor',
  },
  {
    action: 'Cancel',
    who: 'The organizer only',
    when: 'Only before the goal is reached; it can only open refunds',
    enforcedBy: 'cancel.rs — NotOrganizer, GoalReached',
  },
  {
    action: 'Change the recipient',
    who: 'The organizer only',
    when: 'Only before anyone contributes',
    enforcedBy: 'update_recipient.rs — NotOrganizer, RecipientLocked',
  },
] as const
