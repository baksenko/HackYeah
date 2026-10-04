use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::FundraiserError,
    events::RecipientUpdated,
    state::{Campaign, CampaignStatus},
};

#[derive(Accounts)]
pub struct UpdateRecipient<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = organizer @ FundraiserError::NotOrganizer,
    )]
    pub campaign: Account<'info, Campaign>,
}

/// Fixes a mistyped recipient, together with the Solana Pay reference and
/// memo that belong to it. Allowed only while nobody has contributed: the
/// first contribution locks all three for good, so nobody's money can ever
/// be redirected.
pub fn handle_update_recipient(
    ctx: Context<UpdateRecipient>,
    new_recipient: Pubkey,
    reference: Option<Pubkey>,
    memo: String,
) -> Result<()> {
    let campaign = &mut ctx.accounts.campaign;
    require!(
        campaign.status == CampaignStatus::Active,
        FundraiserError::CampaignNotActive
    );
    require!(campaign.total_raised == 0, FundraiserError::RecipientLocked);
    require!(
        new_recipient != Pubkey::default(),
        FundraiserError::InvalidRecipient
    );
    require!(memo.len() <= MAX_MEMO_LEN, FundraiserError::MemoTooLong);

    let old_recipient = campaign.recipient;
    campaign.recipient = new_recipient;
    campaign.reference = reference;
    campaign.memo = memo.clone();

    emit!(RecipientUpdated {
        campaign: campaign.key(),
        old_recipient,
        new_recipient,
        reference,
        memo,
    });
    Ok(())
}
