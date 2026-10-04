use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, TransferChecked},
};

use crate::{
    constants::*,
    error::FundraiserError,
    events::Withdrawn,
    state::{Campaign, CampaignStatus},
};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// Anyone. Withdrawing is permissionless: whoever calls it, the money can
    /// only go to the stored recipient. The caller pays the transaction fee
    /// and, if needed, the rent to open the recipient's token account.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, campaign.organizer.as_ref(), &campaign.campaign_id.to_le_bytes()],
        bump = campaign.bump,
        has_one = recipient @ FundraiserError::NotRecipient,
        has_one = mint @ FundraiserError::WrongMint,
    )]
    pub campaign: Account<'info, Campaign>,

    /// CHECK: pinned to `campaign.recipient` by `has_one`; used only as the
    /// owner of the token account the money goes to. Never signs.
    pub recipient: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The recipient's own associated token account, opened here if it does
    /// not exist yet, so a payout can never be blocked by a missing account.
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token: Account<'info, TokenAccount>,

    /// CHECK: optional, read-only and never used by the program. It only
    /// appears in the transaction so a store can find this payout by the
    /// reference key of its Solana Pay payment request.
    pub reference: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Pays the whole vault to the recipient once the goal has been reached --
/// possibly before the deadline. Possible exactly once.
pub fn handle_withdraw(ctx: Context<Withdraw>) -> Result<()> {
    match ctx.accounts.campaign.status {
        CampaignStatus::Succeeded => {}
        CampaignStatus::Active => return err!(FundraiserError::GoalNotReached),
        CampaignStatus::Withdrawn => return err!(FundraiserError::AlreadyWithdrawn),
        CampaignStatus::Cancelled => return err!(FundraiserError::CampaignCancelled),
    }

    // The full vault: every contribution, plus anything sent to it directly.
    let amount = ctx.accounts.vault.amount;
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
                to: ctx.accounts.recipient_token.to_account_info(),
                authority: ctx.accounts.campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let campaign = &mut ctx.accounts.campaign;
    campaign.status = CampaignStatus::Withdrawn;

    emit!(Withdrawn {
        campaign: campaign.key(),
        recipient: campaign.recipient,
        amount,
        caller: ctx.accounts.caller.key(),
        reference: ctx.accounts.reference.as_ref().map(|r| r.key()),
    });
    Ok(())
}
