use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};

use crate::{
    constants::*,
    error::FundraiserError,
    state::{Campaign, CampaignStatus},
};

#[derive(Accounts)]
pub struct CloseCampaign<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
        mut,
        close = organizer,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = organizer @ FundraiserError::NotOrganizer,
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        mut,
        associated_token::mint = campaign.mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Housekeeping only: reclaims the organizer's own rent deposits (campaign
/// and vault) once the campaign has nothing left to settle. It can never
/// touch contributor money: it is unreachable while any contributor is still
/// owed a refund, and the token program refuses to close a vault that is not
/// empty.
pub fn handle_close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
    let campaign = &ctx.accounts.campaign;
    let now = Clock::get()?.unix_timestamp;

    let paid_out = campaign.status == CampaignStatus::Withdrawn;
    let refunds_open = campaign.status == CampaignStatus::Cancelled
        || (campaign.status == CampaignStatus::Active && now >= campaign.deadline);
    let fully_refunded = refunds_open && campaign.total_refunded == campaign.total_raised;
    require!(
        paid_out || fully_refunded,
        FundraiserError::CampaignNotSettled
    );

    let id_bytes = campaign.campaign_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        CAMPAIGN_SEED,
        campaign.organizer.as_ref(),
        &id_bytes,
        &[campaign.bump],
    ];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.organizer.to_account_info(),
            authority: ctx.accounts.campaign.to_account_info(),
        },
        &[seeds],
    ))?;
    Ok(())
}
