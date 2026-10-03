use anchor_lang::prelude::*;

use crate::constants::MAX_TITLE_LEN;

/// One fundraiser. This account is program-owned and *is* the escrow: the
/// contributed lamports live here, so no human key can move them.
///
/// Invariant on the lamport balance:
///   balance == rent_exempt_reserve + (total_raised - total_refunded)
/// or, after a successful withdrawal, just `rent_exempt_reserve`.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    /// Created the campaign and pays its rent. Holds no power over the funds.
    pub organizer: Pubkey,
    /// The only key that may withdraw on success. Set at creation, never changed.
    pub recipient: Pubkey,
    /// Organizer-chosen id, lets one organizer run many campaigns.
    pub campaign_id: u64,
    /// Human-readable name, at most `MAX_TITLE_LEN` bytes.
    #[max_len(MAX_TITLE_LEN)]
    pub title: String,
    /// Target in lamports. Reaching it is what unlocks `withdraw`.
    pub goal: u64,
    /// Unix timestamp. Before it: only `contribute`. After it: only `withdraw` or `refund`.
    pub deadline: i64,
    /// Sum of every contribution ever made.
    pub total_raised: u64,
    /// Sum of every refund ever paid out.
    pub total_refunded: u64,
    /// Set once by `withdraw`; makes a second withdrawal impossible.
    pub withdrawn: bool,
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
    pub bump: u8,
}
