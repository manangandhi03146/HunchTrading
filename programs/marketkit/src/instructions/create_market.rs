use anchor_lang::prelude::*;

use crate::{constants::*, error::MarketError, state::*};

#[derive(Accounts)]
#[instruction(market_id: [u8; 32])]
pub struct CreateMarket<'info> {
    /// Creator + rent payer. Becomes the market `authority`.
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, authority.key().as_ref(), market_id.as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

pub fn handle_create_market(
    ctx: Context<CreateMarket>,
    market_id: [u8; 32],
    deadline: i64,
    resolver: Pubkey,
    token_mint: Pubkey,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(deadline > now, MarketError::DeadlineInPast);

    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.authority.key();
    market.resolver = resolver;
    market.token_mint = token_mint;
    market.market_id = market_id;
    market.deadline = deadline;
    market.pool = [0, 0];
    market.winning_outcome = None;
    market.status = MarketStatus::Active;
    market.bump = ctx.bumps.market;

    msg!("Market created: deadline={}, resolver={}", deadline, resolver);
    Ok(())
}
