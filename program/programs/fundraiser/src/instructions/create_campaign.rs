use anchor_lang::prelude::*;

use crate::{constants::*, error::FundraiserError, state::Campaign};

#[derive(Accounts)]
#[instruction(campaign_id: u64)]
pub struct CreateCampaign<'info> {
    #[account(mut)]
    pub organizer: Signer<'info>,

    #[account(
        init,
        payer = organizer,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, organizer.key().as_ref(), &campaign_id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    pub system_program: Program<'info, System>,
}

/// Writes the rules once, at birth. There is deliberately no instruction that
/// can edit any of these fields afterwards -- not for the organizer, not for
/// the recipient, not for the program authors.
pub fn handle_create_campaign(
    ctx: Context<CreateCampaign>,
    campaign_id: u64,
    title: String,
    goal: u64,
    deadline: i64,
    recipient: Pubkey,
    invite: Option<Pubkey>,
    tags: u32,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, FundraiserError::TitleTooLong);
    require!(tags.count_ones() <= MAX_TAGS, FundraiserError::TooManyTags);
    require!(goal > 0, FundraiserError::InvalidGoal);

    // Any future deadline is legal, including one two minutes out, so both
    // outcomes can be demonstrated live.
    let now = Clock::get()?.unix_timestamp;
    require!(deadline > now, FundraiserError::InvalidDeadline);

    let campaign = &mut ctx.accounts.campaign;
    campaign.organizer = ctx.accounts.organizer.key();
    campaign.recipient = recipient;
    campaign.campaign_id = campaign_id;
    campaign.title = title;
    campaign.goal = goal;
    campaign.deadline = deadline;
    campaign.total_raised = 0;
    campaign.total_refunded = 0;
    campaign.withdrawn = false;
    campaign.invite = invite;
    campaign.tags = tags;
    campaign.bump = ctx.bumps.campaign;

    msg!(
        "Campaign created: goal {} lamports, deadline {}, recipient {}, {}",
        goal,
        deadline,
        recipient,
        if invite.is_some() { "private" } else { "public" }
    );
    Ok(())
}
