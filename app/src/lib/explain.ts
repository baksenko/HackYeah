import { BN } from '@coral-xyz/anchor'

import { isPrivate, type Campaign, type CampaignStatus, type Contribution } from './campaign'
import { formatDateTime, formatSol, shortKey } from './format'

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
 * substitute for them: every sentence here corresponds to a `require!` in
 * program/programs/fundraiser/src/instructions/.
 */
export function whatCanHappenNow(
  campaign: Campaign,
  status: CampaignStatus,
  viewer: Viewer,
): Explanation {
  const recipient = shortKey(campaign.recipient.toBase58())
  const held = campaign.totalRaised.sub(campaign.totalRefunded)

  switch (status) {
    case 'open': {
      const remaining = campaign.goal.sub(campaign.totalRaised)
      const points = [
        `${formatSol(held)} is locked in the campaign's own account. It is held by the program, not by a person — no organizer, no company, and not the people who built this app.`,
        `Nobody can take it out before ${formatDateTime(campaign.deadline.toNumber())}. There is no instruction in the program that would let them.`,
        remaining.gt(new BN(0))
          ? `${formatSol(remaining)} still needed to reach the goal.`
          : 'The goal is already covered. Contributions are still welcome until the deadline.',
        `If the goal is reached by the deadline, ${viewer.isRecipient ? 'you, as the recipient,' : recipient} will be the only one able to withdraw.`,
        'If it is not reached, every contributor can take back exactly what they paid in.',
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

    case 'succeeded': {
      const points = [
        viewer.isRecipient
          ? `You are the recipient, so you can withdraw ${formatSol(campaign.totalRaised)} now.`
          : `Only ${recipient}, the recipient named when this campaign was created, can withdraw the ${formatSol(campaign.totalRaised)}.`,
        'Nobody else can move the money — not the organizer, and not whoever contributed the most.',
        'Contributors can no longer ask for a refund. Once the goal is met the program refuses that outright.',
        'The recipient was fixed at creation and cannot be changed, so the money cannot be redirected.',
      ]
      return {
        headline: 'The deadline has passed and the goal was reached. The money belongs to the recipient.',
        points,
      }
    }

    case 'failed': {
      const points = [
        'Each contributor gets back exactly what they paid in — not a share of what is left, the exact amount.',
        'The recipient cannot withdraw a thing. The program rejects the attempt with GoalNotReached.',
        'There is no deadline on claiming a refund. Money waits in the program until its contributor asks for it.',
        'No invite link is needed to get money back — even from a private campaign.',
      ]
      if (viewer.myContribution) {
        points.unshift(
          `You contributed ${formatSol(viewer.myContribution.amount)}. You can take it back right now.`,
        )
      }
      if (campaign.totalRefunded.gt(new BN(0))) {
        points.push(
          `${formatSol(campaign.totalRefunded)} of ${formatSol(campaign.totalRaised)} has been reclaimed so far.`,
        )
      }
      return {
        headline:
          'The deadline has passed and the goal was not reached: each contributor can take their money back. Nobody else can touch it.',
        points,
      }
    }

    case 'withdrawn':
      return {
        headline: 'The money has been paid out to the recipient. This campaign is finished.',
        points: [
          `${formatSol(campaign.totalRaised)} went to ${viewer.isRecipient ? 'you' : recipient}.`,
          'A second withdrawal is impossible: the program recorded that it already happened.',
          'The campaign account holds nothing now but the small rent deposit the organizer paid to create it.',
        ],
      }
  }
}

/** Rows for the permissions table shown under the actions. */
export const PERMISSIONS = [
  {
    action: 'Contribute',
    who: 'Anyone (public) · invite-link holders only (private)',
    when: 'Before the deadline',
    enforcedBy: 'contribute.rs — DeadlinePassed, InvalidAmount, InviteRequired, InvalidInvite',
  },
  {
    action: 'Withdraw',
    who: 'The recipient only',
    when: 'After the deadline, if the goal was reached, and only once',
    enforcedBy: 'withdraw.rs — NotRecipient, DeadlineNotReached, GoalNotReached, AlreadyWithdrawn',
  },
  {
    action: 'Get my money back',
    who: 'Each contributor, for their own contribution',
    when: 'After the deadline, if the goal was missed',
    enforcedBy: 'refund.rs — DeadlineNotReached, GoalReached, close = contributor',
  },
] as const
