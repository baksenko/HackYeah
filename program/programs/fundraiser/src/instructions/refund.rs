use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::FundraiserError,
    state::{Campaign, Contribution},
};

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
    )]
    pub campaign: Account<'info, Campaign>,

    /// `close = contributor` hands the rent back and wipes the receipt. That
    /// is what makes a second refund impossible: the account the instruction
    /// needs no longer exists.
    #[account(
        mut,
        close = contributor,
        seeds = [CONTRIBUTION_SEED, campaign.key().as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
        has_one = campaign,
        has_one = contributor,
    )]
    pub contribution: Account<'info, Contribution>,
}

/// Returns exactly what this contributor paid in -- not a share, not a
/// proportion -- and only when the campaign has failed.
pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    {
        let campaign = &ctx.accounts.campaign;
        require!(
            now >= campaign.deadline,
            FundraiserError::DeadlineNotReached
        );
        // A campaign that hit its goal belongs to the recipient; contributors
        // cannot pull out of it.
        require!(
            campaign.total_raised < campaign.goal,
            FundraiserError::GoalReached
        );
    }

    let amount = ctx.accounts.contribution.amount;
    require!(amount > 0, FundraiserError::InvalidAmount);

    let campaign = &mut ctx.accounts.campaign;
    campaign.total_refunded = campaign
        .total_refunded
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;

    let campaign_ai = ctx.accounts.campaign.to_account_info();
    let contributor_ai = ctx.accounts.contributor.to_account_info();

    let reserve = Rent::get()?.minimum_balance(campaign_ai.data_len());
    let remaining = campaign_ai
        .lamports()
        .checked_sub(amount)
        .ok_or(FundraiserError::MathOverflow)?;
    require!(
        remaining >= reserve,
        FundraiserError::InsufficientCampaignBalance
    );

    **campaign_ai.try_borrow_mut_lamports()? = remaining;
    **contributor_ai.try_borrow_mut_lamports()? = contributor_ai
        .lamports()
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;

    msg!("Refunded {} lamports to the contributor", amount);
    Ok(())
}
