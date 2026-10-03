
export const FundraiserErrorCode = {
  DeadlineNotReached: 6000,
  DeadlinePassed: 6001,
  GoalNotReached: 6002,
  GoalReached: 6003,
  NotRecipient: 6004,
  AlreadyWithdrawn: 6005,
  InvalidAmount: 6006,
  TitleTooLong: 6007,
  InvalidGoal: 6008,
  InvalidDeadline: 6009,
  MathOverflow: 6010,
  InsufficientCampaignBalance: 6011,
  CampaignNotSettled: 6012
};

export type FundraiserErrorName = keyof typeof FundraiserErrorCode;
