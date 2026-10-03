use anchor_lang::prelude::*;

use crate::{constants::*, error::FundraiserError, state::Campaign};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Must be the `recipient` recorded at creation. The constraint below is
    /// the whole guarantee: no other key can sign this instruction into
    /// success, whatever a frontend chooses to offer.
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        constraint = campaign.recipient == recipient.key() @ FundraiserError::NotRecipient,
    )]
    pub campaign: Account<'info, Campaign>,
}

/// Pays the whole pot to the recipient, but only once the deadline has passed
/// and only if the goal was actually reached.
pub fn handle_withdraw(ctx: Context<Withdraw>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    {
        let campaign = &ctx.accounts.campaign;
        require!(!campaign.withdrawn, FundraiserError::AlreadyWithdrawn);
        // Checked before the goal, so an early attempt reports the honest
        // reason it failed: the deadline is not here yet.
        require!(
            now >= campaign.deadline,
            FundraiserError::DeadlineNotReached
        );
        require!(
            campaign.total_raised >= campaign.goal,
            FundraiserError::GoalNotReached
        );
    }

    // On the success path no refund can have happened, so the payout is the
    // full amount raised.
    let amount = ctx.accounts.campaign.total_raised;
    ctx.accounts.campaign.withdrawn = true;

    let campaign_ai = ctx.accounts.campaign.to_account_info();
    let recipient_ai = ctx.accounts.recipient.to_account_info();

    // The rent-exempt reserve belongs to whoever paid it and is never part of
    // the pot; paying it out would delete the campaign's own record.
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
    **recipient_ai.try_borrow_mut_lamports()? = recipient_ai
        .lamports()
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;

    msg!("Withdrew {} lamports to the recipient", amount);
    Ok(())
}
