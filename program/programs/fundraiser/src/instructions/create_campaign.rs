use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

use crate::{
    constants::*,
    error::FundraiserError,
    events::CampaignCreated,
    state::{Campaign, CampaignStatus},
};

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

    /// Only the configured USDC mint; any other token is refused.
    #[account(address = USDC_MINT @ FundraiserError::WrongMint)]
    pub mint: Account<'info, Mint>,

    /// The escrow: the campaign's own associated token account for `mint`.
    /// Its authority is the campaign PDA, so only this program can move it.
    #[account(
        init,
        payer = organizer,
        associated_token::mint = mint,
        associated_token::authority = campaign,
        associated_token::token_program = token_program,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
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
    description: String,
    image_url: String,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, FundraiserError::TitleTooLong);
    require!(
        description.len() <= MAX_DESCRIPTION_LEN,
        FundraiserError::DescriptionTooLong
    );
    require!(
        image_url.len() <= MAX_IMAGE_URL_LEN,
        FundraiserError::ImageUrlTooLong
    );
    // Only secure links, so the page never loads a photo over plain http.
    require!(
        image_url.is_empty() || image_url.starts_with("https://"),
        FundraiserError::InvalidImageUrl
    );
    require!(tags.count_ones() <= MAX_TAGS, FundraiserError::TooManyTags);
    require!(goal > 0, FundraiserError::InvalidGoal);
    require!(recipient != Pubkey::default(), FundraiserError::InvalidRecipient);

    // Any future deadline is legal, including one two minutes out, so both
    // outcomes can be demonstrated live.
    let now = Clock::get()?.unix_timestamp;
    require!(deadline > now, FundraiserError::InvalidDeadline);

    let campaign = &mut ctx.accounts.campaign;
    campaign.organizer = ctx.accounts.organizer.key();
    campaign.recipient = recipient;
    campaign.mint = ctx.accounts.mint.key();
    campaign.campaign_id = campaign_id;
    campaign.status = CampaignStatus::Active;
    campaign.title = title;
    campaign.goal = goal;
    campaign.deadline = deadline;
    campaign.total_raised = 0;
    campaign.total_refunded = 0;
    campaign.invite = invite;
    campaign.tags = tags;
    campaign.description = description;
    campaign.image_url = image_url;
    campaign.bump = ctx.bumps.campaign;

    emit!(CampaignCreated {
        campaign: campaign.key(),
        organizer: campaign.organizer,
        recipient,
        mint: campaign.mint,
        goal,
        deadline,
        private: invite.is_some(),
    });
    Ok(())
}
