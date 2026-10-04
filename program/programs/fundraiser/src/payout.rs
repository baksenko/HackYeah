//! The one way money leaves a successful campaign: the whole amount raised,
//! from the campaign's vault, to the stored recipient. Used by `withdraw`
//! (someone presses "pay out") and by `contribute` (the contribution that
//! completes the goal pays out in the same transaction).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TransferChecked};

use crate::{
    constants::*,
    error::FundraiserError,
    state::{Campaign, CampaignStatus},
};

/// A shop's payout must carry its Solana Pay reference so the shop can find
/// it. Anyone can supply it: it is public in the campaign.
pub fn check_reference(campaign: &Campaign, reference: Option<&UncheckedAccount>) -> Result<()> {
    if let Some(expected) = campaign.reference {
        let reference = reference.ok_or(FundraiserError::ReferenceRequired)?;
        require_keys_eq!(reference.key(), expected, FundraiserError::WrongReference);
    }
    Ok(())
}

/// Moves exactly `total_raised` (never more than the goal, since
/// contributions are capped) from the vault to `recipient_token`, signed by
/// the campaign PDA, and marks the campaign Withdrawn. Callers must already
/// have checked that the campaign Succeeded and that `recipient_token`
/// belongs to the stored recipient.
pub fn pay_out<'info>(
    campaign: &mut Account<'info, Campaign>,
    vault: AccountInfo<'info>,
    mint: &Account<'info, Mint>,
    recipient_token: AccountInfo<'info>,
    token_program: Pubkey,
) -> Result<u64> {
    let amount = campaign.total_raised;
    let organizer = campaign.organizer;
    let id_bytes = campaign.campaign_id.to_le_bytes();
    let bump = [campaign.bump];
    let seeds: &[&[u8]] = &[CAMPAIGN_SEED, organizer.as_ref(), &id_bytes, &bump];

    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: vault,
                mint: mint.to_account_info(),
                to: recipient_token,
                authority: campaign.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )?;

    campaign.status = CampaignStatus::Withdrawn;
    Ok(amount)
}
