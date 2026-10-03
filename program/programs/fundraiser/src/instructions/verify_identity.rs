use anchor_lang::prelude::*;

use crate::{constants::*, error::FundraiserError, state::Verification};

#[derive(Accounts)]
pub struct VerifyIdentity<'info> {
    /// The wallet being verified. Signs to accept the record and pays its rent.
    #[account(mut)]
    pub wallet: Signer<'info>,

    /// Must be `KYC_VERIFIER`. Its signature is the verification.
    #[account(address = KYC_VERIFIER @ FundraiserError::NotVerifier)]
    pub verifier: Signer<'info>,

    #[account(
        init,
        payer = wallet,
        space = 8 + Verification::INIT_SPACE,
        seeds = [VERIFICATION_SEED, wallet.key().as_ref()],
        bump
    )]
    pub verification: Account<'info, Verification>,

    pub system_program: Program<'info, System>,
}

/// Records that the verifier vouched for this wallet. Nothing personal is
/// stored -- documents, names and dates of birth never touch the chain.
pub fn handle_verify_identity(ctx: Context<VerifyIdentity>) -> Result<()> {
    let verification = &mut ctx.accounts.verification;
    verification.wallet = ctx.accounts.wallet.key();
    verification.verified_at = Clock::get()?.unix_timestamp;
    verification.bump = ctx.bumps.verification;

    msg!("Identity verified for {}", verification.wallet);
    Ok(())
}
