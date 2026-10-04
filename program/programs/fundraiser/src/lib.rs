//! # Fundraiser
//!
//! A group fundraiser with no middleman, in USDC. Contributions are locked
//! in the campaign's vault, which only this program can move. Once the goal is
//! reached, anyone can trigger the payout -- and it can only go to the stored
//! recipient. If the goal is missed by the deadline, or the organizer cancels
//! before it is reached, every contributor can take back exactly what they
//! paid in. The recipient is locked by the first contribution; goal, deadline
//! and mint can never change. There is no admin, no fee and no pause switch.


pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use events::*;
pub use instructions::*;
pub use state::*;

declare_id!("HZYrUYrRqNt76f8Qh2tcJsxWk2dVep4sFHruWi7k7aJw");

#[program]
pub mod fundraiser {
    use super::*;

    /// Open a campaign. Signer: the organizer, who pays rent and nothing else.
    pub fn create_campaign(
        ctx: Context<CreateCampaign>,
        campaign_id: u64,
        title: String,
        goal: u64,
        deadline: i64,
        recipient: Pubkey,
        invite: Option<Pubkey>,
        tags: u32,
        description: String,
        image_url: String,
        reference: Option<Pubkey>,
        memo: String,
    ) -> Result<()> {
        instructions::create_campaign::handle_create_campaign(
            ctx,
            campaign_id,
            title,
            goal,
            deadline,
            recipient,
            invite,
            tags,
            description,
            image_url,
            reference,
            memo,
        )
    }

    /// Fix the recipient (with its Solana Pay reference and memo) before
    /// anyone has contributed. Signer: the organizer.
    pub fn update_recipient(
        ctx: Context<UpdateRecipient>,
        new_recipient: Pubkey,
        reference: Option<Pubkey>,
        memo: String,
    ) -> Result<()> {
        instructions::update_recipient::handle_update_recipient(ctx, new_recipient, reference, memo)
    }

    /// Put USDC in. Signer: anyone while Active and before the deadline; for
    /// a private campaign, also the invite key from the share link.
    /// `expected_recipient` must match the campaign's current recipient.
    pub fn contribute(
        ctx: Context<Contribute>,
        amount: u64,
        nickname: String,
        expected_recipient: Pubkey,
    ) -> Result<()> {
        instructions::contribute::handle_contribute(ctx, amount, nickname, expected_recipient)
    }

    /// Pay what was raised (the goal) to the stored recipient once the goal
    /// is reached, even before the deadline. Must carry the campaign's
    /// Solana Pay reference when it has one. Signer: anyone (permissionless).
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx)
    }

    /// Take your own money back. Signer: that contributor, once the deadline
    /// passed without reaching the goal, or the campaign was cancelled.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handle_refund(ctx)
    }

    /// Call the campaign off before its goal is reached, opening refunds.
    /// Signer: the organizer.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        instructions::cancel::handle_cancel(ctx)
    }

    /// Reclaim the rent deposits once everything is settled. Signer: the organizer.
    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::close_campaign::handle_close_campaign(ctx)
    }
}
