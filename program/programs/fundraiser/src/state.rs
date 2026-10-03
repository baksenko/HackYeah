use anchor_lang::prelude::*;

use crate::constants::{MAX_DESCRIPTION_LEN, MAX_IMAGE_URL_LEN, MAX_NICKNAME_LEN, MAX_TITLE_LEN};

/// Where a campaign is in its life. Stored, not derived, so every rule can
/// check it directly and the app can filter on it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum CampaignStatus {
    /// Taking contributions.
    Active,
    /// The goal has been reached; the pot can be withdrawn to the recipient.
    Succeeded,
    /// The pot has been paid out to the recipient. Final.
    Withdrawn,
    /// Cancelled by the organizer before the goal was reached; contributors
    /// can take their money back. Final.
    Cancelled,
}

/// One fundraiser. The money is not held here: it sits in this campaign's
/// vault, its associated token account for `mint`, which only this program
/// can move -- to the recipient on success, or back to each contributor.
///
/// Fixed-size fields come first so they sit at fixed offsets for
/// `getProgramAccounts` memcmp filters:
///   organizer 8, recipient 40, mint 72, campaign_id 104, status 112.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    /// Created the campaign and pays its rent. Can change the recipient only
    /// while nothing has been raised, and has no power over the money.
    pub organizer: Pubkey,
    /// Where the pot goes on success. Locked by the first contribution.
    pub recipient: Pubkey,
    /// The token this campaign raises: always the configured `USDC_MINT`.
    pub mint: Pubkey,
    /// Organizer-chosen id, lets one organizer run many campaigns.
    pub campaign_id: u64,
    pub status: CampaignStatus,
    /// Human-readable name, at most `MAX_TITLE_LEN` bytes.
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// Target in the mint's base units. Reaching it is what unlocks `withdraw`.
    pub goal: u64,
    /// Unix timestamp after which no more contributions are accepted.
    pub deadline: i64,
    /// Sum of every contribution ever made.
    pub total_raised: u64,
    /// Sum of every refund ever paid out.
    pub total_refunded: u64,
    /// `Some` makes the campaign private: `contribute` then requires this key
    /// to co-sign. Its secret travels only inside the organizer's share link,
    /// so only people holding that link can join. `None` means public.
    ///
    /// This restricts who can *contribute*. It does not hide the campaign:
    /// every account on Solana is readable by anyone.
    pub invite: Option<Pubkey>,
    /// Up to `MAX_TAGS` labels ("Trip", "Medical", …) as a bitmask, so the
    /// app can filter and search without a database. The catalogue of what
    /// each bit means lives in the app (`app/src/lib/tags.ts`); the program
    /// only stores them, as plain descriptive metadata, never as a rule.
    pub tags: u32,
    /// What the money is for, in the organizer's words. Fixed at creation.
    #[max_len(MAX_DESCRIPTION_LEN)]
    pub description: String,
    /// An `https://` link to a photo hosted elsewhere, or empty. Only the link
    /// is fixed on chain -- whoever hosts the image could still change it.
    #[max_len(MAX_IMAGE_URL_LEN)]
    pub image_url: String,
    pub bump: u8,
}

/// One contributor's running total for one campaign. Its existence is the
/// receipt that entitles them to a refund if the goal is missed; `refund`
/// closes it, which is what makes a double refund impossible.
#[account]
#[derive(InitSpace)]
pub struct Contribution {
    /// First field after the 8-byte discriminator, so the frontend can list a
    /// campaign's contributors with a single memcmp filter at offset 8.
    pub campaign: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    /// How this contributor wants to be shown to the group, e.g. "Kuba".
    /// Chosen by the contributor, per campaign; empty means "show my address".
    #[max_len(MAX_NICKNAME_LEN)]
    pub nickname: String,
    pub bump: u8,
}
