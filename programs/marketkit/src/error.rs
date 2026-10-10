use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Outcome must be 0 or 1")]
    InvalidOutcome,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Market deadline has passed")]
    MarketClosed,
    #[msg("Market deadline has not passed yet")]
    MarketStillOpen,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Only the market's resolver may submit the outcome")]
    UnauthorizedResolver,
    #[msg("Position has already been claimed")]
    AlreadyClaimed,
    #[msg("This position did not back the winning outcome")]
    NotWinningPosition,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
