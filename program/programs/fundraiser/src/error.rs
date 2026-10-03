use anchor_lang::prelude::*;

#[error_code]
pub enum FundraiserError {
    #[msg("The deadline has not been reached yet")]
    DeadlineNotReached,
    #[msg("The deadline has already passed")]
    DeadlinePassed,
    #[msg("The campaign did not reach its goal")]
    GoalNotReached,
    #[msg("The campaign reached its goal, so contributions cannot be refunded")]
    GoalReached,
    #[msg("Only the recipient set at creation can withdraw")]
    NotRecipient,
    #[msg("The funds have already been withdrawn")]
    AlreadyWithdrawn,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Title must be at most 64 bytes")]
    TitleTooLong,
    #[msg("Goal must be greater than zero")]
    InvalidGoal,
    #[msg("Deadline must be in the future")]
    InvalidDeadline,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Campaign balance would drop below its rent-exempt reserve")]
    InsufficientCampaignBalance,
    #[msg("Campaign can only be closed after a withdrawal or after every contribution was refunded")]
    CampaignNotSettled,
    #[msg("This campaign is private: contributing requires the organizer's invite link")]
    InviteRequired,
    #[msg("This invite does not belong to this campaign")]
    InvalidInvite,
    #[msg("Nickname must be at most 32 bytes")]
    NicknameTooLong,
    #[msg("A campaign can have at most 5 tags")]
    TooManyTags,
}
