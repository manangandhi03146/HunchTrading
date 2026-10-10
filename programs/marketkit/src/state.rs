use anchor_lang::prelude::*;

/// On-chain lifecycle. We deliberately store only THREE states, not four:
/// the SDK derives `open` vs `closed` from the deadline, so on-chain we only
/// record the two final states plus the pre-resolution `Active` state.
#[derive(
    AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace,
)]
pub enum MarketStatus {
    Active,
    Resolved,
    Cancelled,
}

/// A single binary prediction market.
///
/// PDA seeds: ["market", authority, market_id]
#[account]
#[derive(InitSpace)]
pub struct Market {
    /// Creator / owner of the market (also part of the PDA seeds).
    pub authority: Pubkey,
    /// MarketKit-managed key authorized to submit the verified outcome.
    pub resolver: Pubkey,
    /// SPL test-token mint this market escrows (zero decimals => integer amounts).
    pub token_mint: Pubkey,
    /// Fixed-size unique id (not an unbounded string).
    pub market_id: [u8; 32],
    /// Unix seconds. `open` vs `closed` is derived from this off-chain.
    pub deadline: i64,
    /// Total staked per outcome: [pool_0, pool_1].
    pub pool: [u64; 2],
    /// Winning outcome, set once resolved.
    pub winning_outcome: Option<u8>,
    pub status: MarketStatus,
    pub bump: u8,
}

/// One accumulated position per (market, wallet, outcome).
///
/// PDA seeds: ["position", market, wallet, outcome]
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub market: Pubkey,
    pub wallet: Pubkey,
    pub outcome: u8,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}
