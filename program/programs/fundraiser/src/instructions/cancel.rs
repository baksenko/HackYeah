use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::FundraiserError,
    events::Cancelled,
    state::{Campaign, CampaignStatus},
};

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub organizer: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = organizer @ FundraiserError::NotOrganizer,
    )]
    pub campaign: Account<'info, Campaign>,
}

/// Calls a campaign off before its goal is reached, which opens refunds for
/// everyone straight away. It cannot move any money itself, and it is not
/// possible once the goal has been reached: a campaign that succeeded stays
/// succeeded.
pub fn handle_cancel(ctx: Context<Cancel>) -> Result<()> {
    let campaign = &mut ctx.accounts.campaign;
    match campaign.status {
        CampaignStatus::Active => {}
        CampaignStatus::Succeeded | CampaignStatus::Withdrawn => {
            return err!(FundraiserError::GoalReached)
        }
        CampaignStatus::Cancelled => return err!(FundraiserError::CampaignCancelled),
    }

    campaign.status = CampaignStatus::Cancelled;
    emit!(Cancelled {
        campaign: campaign.key(),
        total_raised: campaign.total_raised,
    });
    Ok(())
}
