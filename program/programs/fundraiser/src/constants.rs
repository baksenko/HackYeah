use anchor_lang::prelude::*;

/// PDA seed prefix for `Campaign` accounts.
#[constant]
pub const CAMPAIGN_SEED: &[u8] = b"campaign";

/// PDA seed prefix for `Contribution` accounts.
#[constant]
pub const CONTRIBUTION_SEED: &[u8] = b"contribution";

/// Maximum campaign title length, in bytes. Not exported to the IDL because
/// `#[constant]` does not support `usize`.
pub const MAX_TITLE_LEN: usize = 64;

/// Maximum number of tags on one campaign.
pub const MAX_TAGS: u32 = 5;

/// Maximum contributor nickname length, in bytes.
pub const MAX_NICKNAME_LEN: usize = 32;
