//! # Fundraiser
//!
//! A group fundraiser with no middleman. Contributions are locked in a
//! program-owned account. If the goal is reached by the deadline, only the
//! recipient named at creation can withdraw. If it is not, every contributor
//! can reclaim exactly what they paid in. Nothing here can be edited after a
//! campaign is created, and there is no admin, no fee and no pause switch.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use error::*;
pub use instructions::*;
pub use state::*;

declare_id!("DePh1gwDErCKze49Udvkod6FFPsx5UwNmjHr5afhqRu7");

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
    ) -> Result<()> {
        instructions::create_campaign::handle_create_campaign(
            ctx,
            campaign_id,
            title,
            goal,
            deadline,
            recipient,
        )
    }

    /// Put SOL in. Signer: anyone, while the campaign is still open.
    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::contribute::handle_contribute(ctx, amount)
    }

    /// Take the pot. Signer: the recipient only, after a successful deadline.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx)
    }

    /// Take your own money back. Signer: a contributor, after a failed deadline.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        instructions::refund::handle_refund(ctx)
    }

    /// Reclaim the rent deposit once everything is settled. Signer: the organizer.
    pub fn close_campaign(ctx: Context<CloseCampaign>) -> Result<()> {
        instructions::close_campaign::handle_close_campaign(ctx)
    }
}
