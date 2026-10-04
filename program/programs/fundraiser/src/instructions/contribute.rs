use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::{
    constants::*,
    error::FundraiserError,
    events::Contributed,
    state::{Campaign, CampaignStatus, Contribution},
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

    /// The campaign's own mint (always USDC_MINT); needed by transfer_checked.
    #[account(address = campaign.mint @ FundraiserError::WrongMint)]
    pub mint: Account<'info, Mint>,

    /// Where the money comes from: the contributor's own token account for
    /// this mint.
    #[account(
        mut,
        token::mint = mint,
        token::authority = contributor,
        token::token_program = token_program,
    )]
    pub contributor_token: Account<'info, TokenAccount>,

    /// Where the money goes: this campaign's vault and nothing else.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Only for private campaigns: the invite key from the organizer's share
    /// link, co-signing to prove the contributor actually holds that link.
    pub invite: Option<Signer<'info>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Anyone may contribute while the campaign is Active and before its
/// deadline. The tokens move straight into the campaign's vault, so from this
/// moment on no private key -- including the organizer's -- can move them
/// except through `withdraw` (to the recipient) or `refund` (back here).
///
/// `expected_recipient` is the recipient the contributor saw. If the organizer
/// changed it in the meantime the contribution is refused, so nobody ever
/// pays into a campaign for someone other than who they meant.
pub fn handle_contribute(
    ctx: Context<Contribute>,
    amount: u64,
    nickname: String,
    expected_recipient: Pubkey,
) -> Result<()> {
    require!(amount > 0, FundraiserError::InvalidAmount);
    require!(
        nickname.len() <= MAX_NICKNAME_LEN,
        FundraiserError::NicknameTooLong
    );

    // Private campaigns: no invite signature, no contribution. Checked here,
    // in the program, so a modified frontend or a hand-built transaction
    // cannot skip it.
    if let Some(expected) = ctx.accounts.campaign.invite {
        let invite = ctx
            .accounts
            .invite
            .as_ref()
            .ok_or(FundraiserError::InviteRequired)?;
        require_keys_eq!(invite.key(), expected, FundraiserError::InvalidInvite);
    }

    {
        let campaign = &ctx.accounts.campaign;
        // Once the goal is met the campaign is Succeeded and stops taking money.
        require!(
            campaign.status == CampaignStatus::Active,
            FundraiserError::CampaignNotActive
        );
        let now = Clock::get()?.unix_timestamp;
        require!(now < campaign.deadline, FundraiserError::DeadlinePassed);
        // Never past the goal: the payout must equal the goal exactly.
        let remaining = campaign
            .goal
            .checked_sub(campaign.total_raised)
            .ok_or(FundraiserError::MathOverflow)?;
        if amount > remaining {
            msg!("Only {} base units are still needed to reach the goal", remaining);
            return err!(FundraiserError::ExceedsGoal);
        }
        require_keys_eq!(
            campaign.recipient,
            expected_recipient,
            FundraiserError::RecipientChanged
        );
    }

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.contributor_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let campaign_key = ctx.accounts.campaign.key();
    let contributor_key = ctx.accounts.contributor.key();

    let campaign = &mut ctx.accounts.campaign;
    campaign.total_raised = campaign
        .total_raised
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;
    let goal_reached = campaign.total_raised >= campaign.goal;
    if goal_reached {
        campaign.status = CampaignStatus::Succeeded;
    }

    let contribution = &mut ctx.accounts.contribution;
    contribution.campaign = campaign_key;
    contribution.contributor = contributor_key;
    contribution.amount = contribution
        .amount
        .checked_add(amount)
        .ok_or(FundraiserError::MathOverflow)?;
    contribution.bump = ctx.bumps.contribution;
    // Keep the previous nickname when a top-up does not supply a new one.
    if !nickname.is_empty() {
        contribution.nickname = nickname;
    }

    emit!(Contributed {
        campaign: campaign_key,
        contributor: contributor_key,
        amount,
        contributor_total: contribution.amount,
        total_raised: campaign.total_raised,
        goal_reached,
    });
    Ok(())
}
