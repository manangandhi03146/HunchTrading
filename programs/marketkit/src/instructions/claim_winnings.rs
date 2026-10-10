use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{constants::*, error::MarketError, state::*};

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [MARKET_SEED, market.authority.as_ref(), market.market_id.as_ref()],
        bump = market.bump,
        has_one = token_mint,
    )]
    pub market: Account<'info, Market>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, market.key().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = market,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// The caller's position. Seed derivation binds it to (market, user,
    /// outcome), so a user can only ever claim their own position.
    #[account(
        mut,
        seeds = [POSITION_SEED, market.key().as_ref(), user.key().as_ref(), &[position.outcome]],
        bump = position.bump,
        has_one = market,
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        token::mint = token_mint,
        token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
    require!(
        ctx.accounts.market.status == MarketStatus::Resolved,
        MarketError::MarketNotResolved
    );
    let winning = ctx
        .accounts
        .market
        .winning_outcome
        .ok_or(MarketError::MarketNotResolved)?;

    require!(!ctx.accounts.position.claimed, MarketError::AlreadyClaimed);
    require!(
        ctx.accounts.position.outcome == winning,
        MarketError::NotWinningPosition
    );

    // Proportional integer payout: amount * total_pool / winning_pool.
    // Integer division floors, so the sum of all payouts <= total_pool and the
    // rounding dust stays locked in the vault — never over-paid, never owed.
    let pool = ctx.accounts.market.pool;
    let total_pool = pool[0].checked_add(pool[1]).ok_or(MarketError::MathOverflow)?;
    let winning_pool = pool[winning as usize];
    let payout_u128 = (ctx.accounts.position.amount as u128)
        .checked_mul(total_pool as u128)
        .ok_or(MarketError::MathOverflow)?
        .checked_div(winning_pool as u128)
        .ok_or(MarketError::MathOverflow)?;
    let payout = u64::try_from(payout_u128).map_err(|_| MarketError::MathOverflow)?;

    // Mark claimed BEFORE moving funds (guards against any re-entrancy path).
    ctx.accounts.position.claimed = true;

    // The vault's authority is the Market PDA, so the program signs the
    // transfer out using the market's seeds.
    let authority = ctx.accounts.market.authority;
    let market_id = ctx.accounts.market.market_id;
    let bump = [ctx.accounts.market.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[
        MARKET_SEED,
        authority.as_ref(),
        market_id.as_ref(),
        &bump,
    ]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
    )?;

    msg!("Claimed payout={}", payout);
    Ok(())
}
