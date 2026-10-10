use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{constants::*, error::MarketError, state::*};

#[derive(Accounts)]
#[instruction(outcome: u8)]
pub struct PlacePrediction<'info> {
    /// The predictor. Signs the token transfer and pays rent for the
    /// vault / position accounts on first use.
    #[account(mut)]
    pub user: Signer<'info>,

    /// Re-derived from its stored seeds so a forged address can't be passed.
    #[account(
        mut,
        seeds = [MARKET_SEED, market.authority.as_ref(), market.market_id.as_ref()],
        bump = market.bump,
        has_one = token_mint,
    )]
    pub market: Account<'info, Market>,

    pub token_mint: Account<'info, Mint>,

    /// Per-market escrow vault, owned (signed for) by the Market PDA.
    /// Created on the first prediction, reused thereafter.
    #[account(
        init_if_needed,
        payer = user,
        token::mint = token_mint,
        token::authority = market,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The user's token account funding the stake.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// One accumulated position per (market, wallet, outcome).
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Position::INIT_SPACE,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), &[outcome]],
        bump,
    )]
    pub position: Account<'info, Position>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_place_prediction(
    ctx: Context<PlacePrediction>,
    outcome: u8,
    amount: u64,
) -> Result<()> {
    require!(outcome < 2, MarketError::InvalidOutcome);
    require!(amount > 0, MarketError::InvalidOutcome);

    let market = &ctx.accounts.market;
    require!(market.status == MarketStatus::Active, MarketError::MarketNotActive);
    require!(
        Clock::get()?.unix_timestamp < market.deadline,
        MarketError::MarketClosed
    );

    // Move the stake into escrow. If this CPI fails, the whole tx reverts and
    // no state below is persisted.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Upsert the position (fields are idempotent across repeat stakes).
    let position = &mut ctx.accounts.position;
    position.market = ctx.accounts.market.key();
    position.wallet = ctx.accounts.user.key();
    position.outcome = outcome;
    position.bump = ctx.bumps.position;
    position.amount = position
        .amount
        .checked_add(amount)
        .ok_or(MarketError::MathOverflow)?;

    // Update the outcome pool.
    let market = &mut ctx.accounts.market;
    market.pool[outcome as usize] = market.pool[outcome as usize]
        .checked_add(amount)
        .ok_or(MarketError::MathOverflow)?;

    Ok(())
}
