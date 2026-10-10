pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("J7ENUqQR5uxqRB4bbskqCKuDziWkXnJAmxwhM4TLgfrP");

#[program]
pub mod marketkit {
    use super::*;

    /// A3 — create a binary prediction market. Records the market metadata
    /// on-chain; the escrow vault + staking arrive in A4.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: [u8; 32],
        deadline: i64,
        resolver: Pubkey,
        token_mint: Pubkey,
    ) -> Result<()> {
        instructions::create_market::handle_create_market(
            ctx, market_id, deadline, resolver, token_mint,
        )
    }

    /// A4 — stake `amount` test-tokens on `outcome` (0 or 1). Transfers into
    /// the market's escrow vault and records an accumulated Position.
    pub fn place_prediction(
        ctx: Context<PlacePrediction>,
        outcome: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::place_prediction::handle_place_prediction(ctx, outcome, amount)
    }

    /// A5 — the market's resolver records the verified winning outcome.
    pub fn resolve_market(ctx: Context<ResolveMarket>, winning_outcome: u8) -> Result<()> {
        instructions::resolve_market::handle_resolve_market(ctx, winning_outcome)
    }

    /// A6 — a winner claims their proportional share of the pool from escrow.
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        instructions::claim_winnings::handle_claim_winnings(ctx)
    }
}
