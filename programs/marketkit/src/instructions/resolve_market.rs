use anchor_lang::prelude::*;

use crate::{constants::*, error::MarketError, state::*};

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Must match `market.resolver` (enforced by `has_one`). This is the
    /// MarketKit-managed key that submits verified outcomes.
    pub resolver: Signer<'info>,

    #[account(
        mut,
        seeds = [MARKET_SEED, market.authority.as_ref(), market.market_id.as_ref()],
        bump = market.bump,
        has_one = resolver,
    )]
    pub market: Account<'info, Market>,
}

pub fn handle_resolve_market(ctx: Context<ResolveMarket>, winning_outcome: u8) -> Result<()> {
    require!(winning_outcome < 2, MarketError::InvalidOutcome);

    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Active,
        MarketError::MarketNotActive
    );
    require!(
        Clock::get()?.unix_timestamp >= market.deadline,
        MarketError::MarketStillOpen
    );

    market.winning_outcome = Some(winning_outcome);
    market.status = MarketStatus::Resolved;

    msg!("Market resolved: winning_outcome={}", winning_outcome);
    Ok(())
}
