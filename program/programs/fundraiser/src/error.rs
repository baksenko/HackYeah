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
    #[msg("Description must be at most 300 bytes")]
    DescriptionTooLong,
    #[msg("Image link must be at most 200 bytes")]
    ImageUrlTooLong,
    #[msg("Image link must be empty or start with https://")]
    InvalidImageUrl,
    #[msg("This program only accepts the configured USDC mint")]
    WrongMint,
    #[msg("Only the organizer of this campaign can do this")]
    NotOrganizer,
    #[msg("The campaign is no longer taking changes")]
    CampaignNotActive,
    #[msg("The recipient is locked once anyone has contributed")]
    RecipientLocked,
    #[msg("The recipient must be a real address")]
    InvalidRecipient,
    #[msg("The recipient changed since you looked; check the campaign again")]
    RecipientChanged,
    #[msg("The campaign was cancelled; contributors can take their money back")]
    CampaignCancelled,
}
