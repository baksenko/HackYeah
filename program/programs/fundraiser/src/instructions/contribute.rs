use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::FundraiserError,
    state::{Campaign, Contribution},
};

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    /// Created on the contributor's first contribution, topped up afterwards.
    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + Contribution::INIT_SPACE,
        seeds = [CONTRIBUTION_SEED, campaign.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    pub system_program: Program<'info, System>,
}

/// Anyone may contribute while the campaign is open. The lamports go straight
/// into the program-owned `Campaign` account, so from this moment on no
/// private key -- including the organizer's -- can move them except through
/// `withdraw` or `refund`.
pub fn handle_contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
    require!(amount > 0, FundraiserError::InvalidAmount);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now < ctx.accounts.campaign.deadline,
        FundraiserError::DeadlinePassed
    );

    // Overfunding past the goal stays allowed until the deadline.
    let cpi_accounts = anchor_lang::system_program::Transfer {
        from: ctx.accounts.contributor.to_account_info(),
        to: ctx.accounts.campaign.to_account_info(),
    };
    anchor_lang::system_program::transfer(
        CpiContext::new(anchor_lang::system_program::ID, cpi_accounts),
        amount,
    )?;

    let campaign_key = ctx.accounts.campaign.key();
    let contributor_key = ctx.accounts.contributor.key();

    let campaign = &mut ctx.accounts.campaign;
    campaign.total_raised = campaign
        .total_raised
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;

    let contribution = &mut ctx.accounts.contribution;
    contribution.campaign = campaign_key;
    contribution.contributor = contributor_key;
    contribution.amount = contribution
        .amount
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;
    contribution.bump = ctx.bumps.contribution;

    msg!(
        "Contributed {} lamports; campaign total is now {}",
        amount,
        campaign.total_raised
    );
    Ok(())
}
