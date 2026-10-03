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

/// Maximum campaign description length, in bytes.
pub const MAX_DESCRIPTION_LEN: usize = 500;

/// Maximum campaign image link length, in bytes.
pub const MAX_IMAGE_URL_LEN: usize = 200;

#[cfg(all(feature = "devnet", feature = "mainnet"))]
compile_error!("enable at most one of the `devnet` and `mainnet` features");

/// The only token this program accepts. Chosen at build time:
/// `--features mainnet` for real USDC, `--features devnet` for Circle's devnet
/// USDC, neither for localnet and tests.
#[cfg(feature = "mainnet")]
#[constant]
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

#[cfg(all(feature = "devnet", not(feature = "mainnet")))]
#[constant]
pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

/// LOCALNET / TESTS ONLY: a stand-in "USDC" mint whose address comes from the
/// public seed sha256("chip-in:localnet-test-usdc:v1"), so tests and the local
/// seed script can create it at exactly this address. Worthless by design.
#[cfg(not(any(feature = "devnet", feature = "mainnet")))]
#[constant]
pub const USDC_MINT: Pubkey = pubkey!("BSMC8D2tMSKrz5HFsNKJmAHDDsocVD5MypWD9podcoUe");

/// USDC has 6 decimals on every cluster; `transfer_checked` verifies it.
#[constant]
pub const USDC_DECIMALS: u8 = 6;

/// PDA seed prefix for `Verification` accounts.
#[constant]
pub const VERIFICATION_SEED: &[u8] = b"verification";

/// The only key allowed to mark a wallet as identity-verified.
///
/// DEMO ONLY: this is derived from the public seed
/// sha256("chip-in:demo-kyc-verifier:v1"), so anyone can act as this
/// verifier. The on-chain check is real; the identity check behind it is a
/// mock. For production, replace this with the key of a real KYC provider
/// that signs only after checking documents on its own server.
#[constant]
pub const KYC_VERIFIER: Pubkey = pubkey!("6heuxcXmpLasM5dYeoFFFAXnhGLKLZNG4mPGFMZfqX3z");
