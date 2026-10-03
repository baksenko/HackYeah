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

/// Emitted by `update_recipient`, which is only possible before anyone has
/// contributed.
#[event]
pub struct RecipientUpdated {
    pub campaign: Pubkey,
    pub old_recipient: Pubkey,
    pub new_recipient: Pubkey,
}
