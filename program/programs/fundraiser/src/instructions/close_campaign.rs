use anchor_lang::prelude::*;

use crate::{constants::*, error::FundraiserError, state::Campaign};

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
        mut,
        close = organizer,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = organizer,
    )]
    pub campaign: Account<'info, Campaign>,
}

/// Housekeeping only: reclaims the organizer's own rent deposit once the
/// campaign has nothing left to settle. It can never touch contributor money,
/// because it is unreachable while any contributor is still owed a refund.
pub fn handle_close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
    let campaign = &ctx.accounts.campaign;
    let now = Clock::get()?.unix_timestamp;

    let paid_out = campaign.withdrawn;
    let fully_refunded = now >= campaign.deadline
        && campaign.total_raised < campaign.goal
        && campaign.total_refunded == campaign.total_raised;

    require!(
        paid_out || fully_refunded,
        FundraiserError::CampaignNotSettled
    );

    msg!("Campaign closed; rent returned to the organizer");
    Ok(())
}
