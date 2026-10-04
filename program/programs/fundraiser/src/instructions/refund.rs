use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::FundraiserError,
    events::Refunded,
    state::{Campaign, CampaignStatus, Contribution},
};

#[derive(Accounts)]
pub struct Refund<'info> {
    /// The contributor, asking for their own money back. Nobody else's
    /// permission is needed.
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = mint @ FundraiserError::WrongMint,
    )]
    pub campaign: Account<'info, Campaign>,

    /// The receipt. `close = contributor` deletes it as it pays out and hands
    /// its rent back, which is what makes a second refund impossible.
    #[account(
        mut,
        close = contributor,
        seeds = [CONTRIBUTION_SEED, campaign.key().as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
        has_one = campaign,
        has_one = contributor,
    )]
    pub contribution: Account<'info, Contribution>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The contributor's own associated token account, reopened if they
    /// closed it since contributing.
    #[account(
        init_if_needed,
        payer = contributor,
        associated_token::mint = mint,
        associated_token::authority = contributor,
        associated_token::token_program = token_program,
    )]
    pub contributor_token: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Returns exactly what this contributor put in, once the campaign failed
/// (deadline passed without reaching the goal) or was cancelled.
pub fn handle_refund(ctx: Context<Refund>) -> Result<()> {
    {
        let campaign = &ctx.accounts.campaign;
        match campaign.status {
            CampaignStatus::Cancelled => {}
            CampaignStatus::Active => {
                let now = Clock::get()?.unix_timestamp;
                require!(now >= campaign.deadline, FundraiserError::DeadlineNotReached);
            }
            // The goal was reached: the money belongs to the recipient.
            CampaignStatus::Succeeded | CampaignStatus::Withdrawn => {
                return err!(FundraiserError::GoalReached)
            }
        }
    }

    let amount = ctx.accounts.contribution.amount;
    require!(amount > 0, FundraiserError::InvalidAmount);

    let campaign = &ctx.accounts.campaign;
    let id_bytes = campaign.campaign_id.to_le_bytes();
    let seeds: &[&[u8]] = &[
        CAMPAIGN_SEED,
        campaign.organizer.as_ref(),
        &id_bytes,
        &[campaign.bump],
    ];

    token::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.contributor_token.to_account_info(),
                authority: ctx.accounts.campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.total_refunded = campaign
        .total_refunded
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;

    emit!(Refunded {
        campaign: campaign.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
        total_refunded: campaign.total_refunded,
    });
    Ok(())
}
