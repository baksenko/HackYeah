use anchor_lang::prelude::*;

/// Emitted by `create_campaign`.
#[event]
pub struct CampaignCreated {
    pub campaign: Pubkey,
    pub organizer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub goal: u64,
    pub deadline: i64,
    pub private: bool,
}

/// Emitted by `contribute`.
#[event]
pub struct Contributed {
    pub campaign: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    /// This contributor's running total in the campaign.
    pub contributor_total: u64,
    pub total_raised: u64,
    /// True when this contribution reached the goal (status became Succeeded).
    pub goal_reached: bool,
}

/// Emitted by `update_recipient`, which is only possible before anyone has
/// contributed.
#[event]
pub struct RecipientUpdated {
    pub campaign: Pubkey,
    pub old_recipient: Pubkey,
    pub new_recipient: Pubkey,
}
